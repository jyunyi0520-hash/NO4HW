/**
 * 公司內部點餐工具 Core Logic - 宇宙版
 */

// --- 設定 ---
const CONFIG = {
    CLIENT_ID: '809889420933-c83k3kmu0pmbc5su2p76qakp3982ru5k.apps.googleusercontent.com',
    API_KEY: 'AIzaSyC9bWxTMtYGIQvDElLJm0uzX_NeED4zNHs',
    SPREADSHEET_ID: '1KlgrLdxKG2G-UamhDFMz_1kke7wgege03PSIUhU15Ok',
    DISCOVERY_DOC: 'https://sheets.googleapis.com/$discovery/rest?version=v4',
    SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid',
};

// --- 全域變數 ---
let tokenClient;
let gapiInited = false;
let currentUser = null; 
let currentGlobalMenu = []; // 儲存今日菜單以便進行搜尋過濾

const SHEETS = { TODAY: 'TodayConfig', MENU: 'Menu', USERS: 'Users', ORDERS: 'Orders' };

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('sign-out-btn').addEventListener('click', handleSignOut);
    document.getElementById('btn-open-config').addEventListener('click', showConfigPanel);
    document.getElementById('btn-save-config').addEventListener('click', saveTodayConfig);
    document.getElementById('btn-clear-orders').addEventListener('click', clearOrders);
    document.getElementById('btn-show-orders').addEventListener('click', openOrdersModal);
    document.querySelector('.close-modal').addEventListener('click', closeOrdersModal);
    document.getElementById('btn-copy-orders').addEventListener('click', copyOrdersToClipboard);
    
    // 搜尋功能綁定
    document.getElementById('search-input').addEventListener('input', handleSearch);

    const loginBtn = document.getElementById('custom-login-btn');
    if (loginBtn) loginBtn.addEventListener('click', handleLoginClick);

    window.onclick = function (event) {
        const modal = document.getElementById('orders-modal');
        if (event.target == modal) closeOrdersModal();
    }

    initGapiClient().then(() => {
        tryAutoLogin();
    }).catch(err => {
        showLogin();
    });
});

// --- UI 工具與可愛提示 ---
function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.innerHTML = `✨ ${msg}`;
    toast.classList.remove('hidden');
    
    // 觸發重繪以播放動畫
    void toast.offsetWidth;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.classList.add('hidden'), 500); // 動畫結束後隱藏
    }, 3000);
}

function showLoading(msg) {
    document.getElementById('status-section').classList.remove('hidden');
    document.getElementById('status-text').textContent = msg || '系統啟動中... 🚀';
}

function hideLoading() { document.getElementById('status-section').classList.add('hidden'); }
function showLogin() { document.getElementById('login-section').classList.remove('hidden'); document.getElementById('app-section').classList.add('hidden'); }
function hideLogin() { document.getElementById('login-section').classList.add('hidden'); }

// --- Google API 與 Auth 邏輯 (保留原樣) ---
async function handleLoginClick() {
    try {
        showLoading('核對艦隊通行證中... 🆔');
        await initGapiClient();
        const token = await requestAccessToken(true);
        await handleAuthFlow(token);
    } catch (err) {
        alert("登入失敗，請檢查通訊設備！");
        showLogin();
        hideLoading();
    }
}

async function tryAutoLogin() {
    const savedToken = loadTokenFromStorage();
    if (!savedToken) return showLogin();
    gapi.client.setToken({ access_token: savedToken });
    try {
        await handleAuthFlow(savedToken);
    } catch (err) {
        localStorage.clear();
        gapi.client.setToken('');
        showLogin();
        hideLoading();
    }
}

async function handleAuthFlow(accessToken) {
    showLoading('載入星際圖資中... 🌌');
    hideLogin();
    gapi.client.setToken({ access_token: accessToken });
    const profile = await fetchUserProfile(accessToken);
    if (!profile) throw new Error("無效的通行證");

    const email = profile.email;
    const name = profile.name || email.split('@')[0];
    const userRole = await checkUserPermission(email);

    if (!userRole) {
        alert('抱歉，您不在艦隊名單中。請聯繫指揮官。');
        return handleSignOut();
    }

    currentUser = { email, name, role: userRole };
    updateUIForUser();
    await loadAppArgs();
}

async function fetchUserProfile(accessToken) {
    try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { 'Authorization': `Bearer ${accessToken}` } });
        return res.ok ? await res.json() : null;
    } catch (e) { return null; }
}

function initGapiClient() {
    return new Promise((resolve, reject) => {
        if (gapiInited) return resolve();
        gapi.load('client', async () => {
            try {
                await gapi.client.init({ apiKey: CONFIG.API_KEY, discoveryDocs: [CONFIG.DISCOVERY_DOC] });
                gapiInited = true; resolve();
            } catch (err) { reject(err); }
        });
    });
}

function requestAccessToken(forcePrompt = false) {
    return new Promise((resolve, reject) => {
        if (!forcePrompt) {
            const savedToken = loadTokenFromStorage();
            if (savedToken) { gapi.client.setToken({ access_token: savedToken }); return resolve(savedToken); }
        }
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CONFIG.CLIENT_ID,
            scope: CONFIG.SCOPES,
            callback: (res) => {
                if (res && res.access_token) { saveTokenToStorage(res); resolve(res.access_token); } 
                else reject("Failed");
            },
            error_callback: reject
        });
        tokenClient.requestAccessToken({ prompt: forcePrompt ? 'consent' : '' });
    });
}

function saveTokenToStorage(res) {
    localStorage.setItem('google_access_token', res.access_token);
    localStorage.setItem('google_token_expires_at', Date.now() + (res.expires_in * 1000) - 300000);
}

function loadTokenFromStorage() {
    const token = localStorage.getItem('google_access_token');
    const exp = localStorage.getItem('google_token_expires_at');
    if (!token || !exp) return null;
    return Date.now() < parseInt(exp) ? token : (localStorage.clear(), null);
}

function handleSignOut() {
    const token = gapi.client.getToken();
    if (token) { google.accounts.oauth2.revoke(token.access_token); gapi.client.setToken(''); }
    localStorage.clear();
    currentUser = null;
    document.getElementById('user-info').classList.add('hidden');
    document.getElementById('app-section').classList.add('hidden');
    document.getElementById('order-summary-section').classList.add('hidden');
    showLogin();
}

async function checkUserPermission(email) {
    try {
        const res = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId: CONFIG.SPREADSHEET_ID, range: `${SHEETS.USERS}!A:C` });
        const rows = res.result.values;
        if (!rows) return null;
        for (let i = 1; i < rows.length; i++) if (rows[i][1] === email) return rows[i][2];
        return null;
    } catch (e) { return null; }
}

function updateUIForUser() {
    document.getElementById('user-info').classList.remove('hidden');
    document.getElementById('user-name').innerHTML = `🧑‍🚀 ${currentUser.name} (${currentUser.role})`;
    document.getElementById('admin-section').classList.toggle('hidden', currentUser.role !== '管理員');
    document.getElementById('order-summary-section').classList.remove('hidden');
}

// --- 業務邏輯 (新增數量與過濾) ---
async function loadAppArgs() {
    showLoading('正在接收星球菜單電波... 📡');
    try {
        const todayConfig = await getTodayRestaurants();
        document.getElementById('today-restaurants').textContent = todayConfig.length > 0 ? `(${todayConfig.join(', ')})` : '(尚未設定航線)';

        const allMenu = await getAllMenu();
        
        // 過濾並儲存今日菜單至全域變數
        currentGlobalMenu = allMenu.filter(item => todayRestaurants.includes(item.restaurant));
        
        renderMenu(currentGlobalMenu);
        hideLoading();
        document.getElementById('app-section').classList.remove('hidden');
    } catch (err) {
        alert("訊號異常，載入資料失敗。");
        hideLoading();
    }
}

async function getTodayRestaurants() {
    const res = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId: CONFIG.SPREADSHEET_ID, range: `${SHEETS.TODAY}!A:A` });
    return res.result.values ? res.result.values.slice(1).map(r => r[0]).filter(v => v) : [];
}

async function getAllMenu() {
    const res = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId: CONFIG.SPREADSHEET_ID, range: `${SHEETS.MENU}!A:D` });
    const rows = res.result.values;
    return rows && rows.length > 1 ? rows.slice(1).map(r => ({ restaurant: r[0], name: r[1], price: r[2], category: r[3] })) : [];
}

// 搜尋過濾功能
function handleSearch(e) {
    const keyword = e.target.value.toLowerCase();
    const filteredMenu = currentGlobalMenu.filter(item => 
        item.name.toLowerCase().includes(keyword) || 
        item.restaurant.toLowerCase().includes(keyword) ||
        (item.category && item.category.toLowerCase().includes(keyword))
    );
    renderMenu(filteredMenu);
}

// 變更數量功能
function changeQty(btnElement, delta) {
    const input = btnElement.parentElement.querySelector('.qty-input');
    let currentVal = parseInt(input.value) || 1;
    currentVal += delta;
    if (currentVal < 1) currentVal = 1;
    input.value = currentVal;
}

function renderMenu(menuData) {
    const container = document.getElementById('menu-container');
    container.innerHTML = '';

    if (menuData.length === 0) {
        container.innerHTML = '<p class="placeholder-text">🕳️ 此區域像黑洞一樣空空如也...</p>';
        return;
    }

    menuData.forEach(item => {
        const card = document.createElement('div');
        card.className = 'card menu-item';
        
        // 分類 Emoji 對應 (可自行擴充)
        let catEmoji = '🍽️';
        if(item.category) {
            if(item.category.includes('飲')) catEmoji = '🥤';
            else if(item.category.includes('飯')) catEmoji = '🍛';
            else if(item.category.includes('麵')) catEmoji = '🍜';
            else if(item.category.includes('心') || item.category.includes('甜')) catEmoji = '🍰';
        }

        card.innerHTML = `
            <div class="badge">${catEmoji} ${item.category || '未分類'}</div>
            <h4>${item.restaurant}</h4>
            <h3 style="margin-top: 0;">${item.name}</h3>
            
            <div class="price-box">
                <div class="price">$${item.price}</div>
                <div class="qty-control">
                    <button class="qty-btn" onclick="changeQty(this, -1)">-</button>
                    <input type="text" class="qty-input" value="1" readonly>
                    <button class="qty-btn" onclick="changeQty(this, 1)">+</button>
                </div>
            </div>

            <input type="text" class="note-input" placeholder="備註 (如：少冰、不要香菜 🌿)">
            <button class="btn btn-primary btn-order" onclick="submitOrder('${item.restaurant}', '${item.name}', ${item.price}, this)">發射點餐 🚀</button>
        `;
        container.appendChild(card);
    });
}

// 提交訂單 (新增數量與總價邏輯)
async function submitOrder(restaurant, foodName, unitPrice, btnElement) {
    if (!currentUser) return;

    const card = btnElement.parentElement;
    const note = card.querySelector('.note-input').value;
    const qty = parseInt(card.querySelector('.qty-input').value) || 1;
    const totalPrice = unitPrice * qty;
    const timestamp = new Date().toLocaleString('zh-TW', { hour12: false });

    btnElement.disabled = true;
    btnElement.textContent = '發射中... 🛸';

    // 格式: [時間, Email, 餐廳, 餐點, 數量, 總金額, 備註]
    const orderData = [timestamp, currentUser.email, restaurant, foodName, qty, totalPrice, note];

    try {
        await gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId: CONFIG.SPREADSHEET_ID,
            range: `${SHEETS.ORDERS}!A:G`, // 擴充到 G 欄
            valueInputOption: 'USER_ENTERED',
            resource: { values: [orderData] }
        });

        // 取代原本生硬的 alert
        showToast(`「${foodName} x${qty}」已成功發射到廚房囉！🚀`);
        
        card.querySelector('.note-input').value = ''; 
        card.querySelector('.qty-input').value = '1'; // 重置數量
    } catch (err) {
        alert("發射失敗，遭遇隕石群阻擋！請重試。");
    } finally {
        btnElement.disabled = false;
        btnElement.textContent = '發射點餐 🚀';
    }
}

// --- 管理員與表單檢視邏輯 ---
async function showConfigPanel() {
    const panel = document.getElementById('admin-config-panel');
    const container = document.getElementById('restaurant-checkboxes');
    container.innerHTML = '掃描星系中... 🛰️';
    panel.classList.remove('hidden');

    try {
        const allMenu = await getAllMenu();
        const restaurants = [...new Set(allMenu.map(item => item.restaurant))];
        container.innerHTML = '';
        restaurants.forEach(r => {
            const div = document.createElement('label');
            div.innerHTML = `<input type="checkbox" value="${r}" name="restaurant-select"> ${r}`;
            container.appendChild(div);
        });
    } catch (err) { container.textContent = '掃描失敗'; }
}

async function saveTodayConfig() {
    const checkboxes = document.querySelectorAll('input[name="restaurant-select"]:checked');
    const selected = Array.from(checkboxes).map(cb => cb.value);

    if (selected.length === 0 && !confirm('確定不選擇任何餐廳嗎？(太空人會餓死喔👽)')) return;

    try {
        await gapi.client.sheets.spreadsheets.values.clear({ spreadsheetId: CONFIG.SPREADSHEET_ID, range: `${SHEETS.TODAY}!A2:A` });
        if (selected.length > 0) {
            await gapi.client.sheets.spreadsheets.values.append({
                spreadsheetId: CONFIG.SPREADSHEET_ID,
                range: `${SHEETS.TODAY}!A2`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: selected.map(r => [r]) }
            });
        }
        showToast('座標已成功儲存！🗺️');
        document.getElementById('admin-config-panel').classList.add('hidden');
        loadAppArgs();
    } catch (err) { alert('儲存失敗'); }
}

async function clearOrders() {
    if (!confirm('⚠️ 警告：確定要啟動黑洞，吸走今日所有訂單資料嗎？此動作無法復原！')) return;
    try {
        await gapi.client.sheets.spreadsheets.values.clear({ spreadsheetId: CONFIG.SPREADSHEET_ID, range: `${SHEETS.ORDERS}!A2:G` });
        showToast('訂單已全數被黑洞吞噬 🕳️');
    } catch (err) { alert('清除失敗'); }
}

async function openOrdersModal() {
    const modal = document.getElementById('orders-modal');
    const tbody = document.getElementById('orders-list');
    const totalSpan = document.getElementById('total-amount');

    tbody.innerHTML = '<tr><td colspan="7" class="text-center">讀取通訊紀錄中... 📡</td></tr>';
    modal.classList.remove('hidden');

    try {
        const res = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId: CONFIG.SPREADSHEET_ID, range: `${SHEETS.ORDERS}!A2:G` });
        const rows = res.result.values || [];
        tbody.innerHTML = '';

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center">目前沒有人點餐，太空艙很安靜。</td></tr>';
            totalSpan.textContent = '0';
            return;
        }

        let total = 0;
        rows.forEach(row => {
            const tr = document.createElement('tr');
            const qty = parseInt(row[4]) || 1;
            const price = parseInt(row[5]) || 0; // 第6欄是總金額
            total += price;

            tr.innerHTML = `
                <td>${row[0]}</td>
                <td>${row[1].split('@')[0]}</td>
                <td>${row[2]}</td>
                <td>${row[3]}</td>
                <td>${qty}</td>
                <td style="color:var(--warning-color); font-weight:bold;">${price}</td>
                <td>${row[6] || ''}</td>
            `;
            tbody.appendChild(tr);
        });
        totalSpan.textContent = total;
    } catch (err) { tbody.innerHTML = '<tr><td colspan="7" class="text-center">載入失敗</td></tr>'; }
}

function closeOrdersModal() { document.getElementById('orders-modal').classList.add('hidden'); }

function copyOrdersToClipboard() {
    const rows = document.querySelectorAll('#orders-list tr');
    let text = "🛸 今日宇宙航站補給清單：\n\n";

    rows.forEach(row => {
        const cols = row.querySelectorAll('td');
        if (cols.length < 6) return; 
        
        const time = cols[0].textContent.split(' ')[1]; // 僅取時間
        const user = cols[1].textContent;
        const restaurant = cols[2].textContent;
        const food = cols[3].textContent;
        const qty = cols[4].textContent;
        const price = cols[5].textContent;
        const note = cols[6].textContent ? `(${cols[6].textContent})` : '';

        text += `[${restaurant}] ${food} x${qty} ($${price}) - ${user} ${note}\n`;
    });

    const total = document.getElementById('total-amount').textContent;
    text += `\n💰 總消耗宇宙幣：${total} 元`;

    navigator.clipboard.writeText(text).then(() => showToast('已成功複製到記憶體！📋'), () => alert('複製失敗，請手動圈選。'));
}
