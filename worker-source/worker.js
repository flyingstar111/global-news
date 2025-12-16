// Worker 代理代码 (Final Triple Failover Edition - Keys Secured)
const BING_NEWS_URL = 'https://api.bing.microsoft.com/v7.0/news/search';
const GNEWS_API_URL = 'https://gnews.io/api/v4/top-headlines';
const GNEWS_SEARCH_URL = 'https://gnews.io/api/v4/search';
const NEWSAPI_URL = 'https://newsapi.org/v2/top-headlines'; 
const NEWSAPI_SEARCH_URL = 'https://newsapi.org/v2/everything'; 

// News API 要求 User-Agent 头部
const NEWSAPI_HEADERS = {
    'User-Agent': 'news-aggregator-app-v1' 
};
const GNEWS_SORT = 'publishedAt';
const NEWSAPI_SORT = 'publishedAt';

// 【核心】 Bing News 头部，用于认证
const BING_HEADERS = (apiKey) => ({
    'Ocp-Apim-Subscription-Key': apiKey,
    'User-Agent': 'news-aggregator-app-v1'
});

// 【入口点修复】：确保 Worker 能够运行
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});


// 辅助函数：处理 CORS 和 Headers (保持不变)
const buildResponse = (response) => {
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Access-Control-Allow-Origin', '*'); 
    newHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    newHeaders.delete('Content-Encoding'); 
    newHeaders.delete('Content-Length'); 
    newHeaders.delete('Transfer-Encoding');

    return new Response(response.body, { status: response.status, headers: newHeaders });
};

// 辅助函数：构建错误响应 (保持不变)
const buildErrorResponse = (message, status = 503) => {
    return new Response(JSON.stringify({ 
        errors: [{ message: message }] 
    }), { status: status, headers: { 'Access-Control-Allow-Origin': '*' } });
};


// =========================================================
// API 函数 - 1. Bing News (Primary)
// =========================================================

async function fetchNewsFromBing(country, query, topic) {
    if (typeof BING_NEWS_API_KEY === 'undefined' || BING_NEWS_API_KEY.length < 5) {
        return { status: 500, failed: true, message: "Bing News API Key 未配置" };
    }
    
    let bingParams = new URLSearchParams();
    
    bingParams.set('sortBy', 'Date'); 
    const mktMap = { 'us': 'en-US', 'gb': 'en-GB', 'cn': 'zh-CN', 'hk': 'zh-HK', 'jp': 'ja-JP', 'kr': 'ko-KR', 'sg': 'en-SG', 'in': 'en-IN', 'de': 'de-DE' };
    
    const market = mktMap[country] || 'en-US';
    bingParams.set('mkt', market);
    
    let finalQuery = query || "";
    if (topic) {
        const topicMap = { 'business': 'finance OR business', 'technology': 'tech OR technology', 'crypto': 'cryptocurrency OR bitcoin' };
        finalQuery += (finalQuery ? ' AND ' : '') + (topicMap[topic] || topic);
    }
    
    bingParams.set('q', finalQuery || 'world news');
    
    const bingUrl = `${BING_NEWS_URL}?${bingParams.toString()}`;
    
    try {
        const bingResponse = await fetch(bingUrl, { headers: BING_HEADERS(BING_NEWS_API_KEY) });

        if (bingResponse.ok) {
            const bingData = await bingResponse.json();
            
            // 结构转换 (映射到 articles 数组)
            const articles = (bingData.value || []).map(item => ({
                title: item.name,
                description: item.description,
                url: item.url,
                image: item.image?.thumbnail?.contentUrl,
                publishedAt: item.datePublished,
                source: { name: item.provider?.[0]?.name || 'Bing News' }
            }));
            
            return { status: 200, response: new Response(JSON.stringify({ articles: articles })) };
        } else {
            const errorData = await bingResponse.json().catch(() => ({}));
            let errorMsg = errorData.errors?.[0]?.message || errorData.message || `Bing API failed with status ${bingResponse.status}`;
            return { status: bingResponse.status, failed: true, message: `Bing News API 错误: ${errorMsg}` };
        }
    } catch (e) {
        return { status: 503, failed: true, message: `Bing News API 网络连接失败或超时。` };
    }
}


// =========================================================
// API 函数 - 2. GNews (Secondary)
// =========================================================

async function fetchNewsFromGNews(country, query, topic) {
    // 【核心变化】：直接依赖 Worker Secrets 中的 GNEWS_API_KEY
    if (typeof GNEWS_API_KEY === 'undefined' || GNEWS_API_KEY.length < 5) {
        return { status: 500, failed: true, message: "GNews API Key 未配置" };
    }
    
    let gnewsParams = new URLSearchParams();
    gnewsParams.set('sortby', GNEWS_SORT); 
    gnewsParams.set('token', GNEWS_API_KEY); // 使用 Secrets Key

    // 传递前端参数
    if (country) gnewsParams.set('country', country);
    if (topic) gnewsParams.set('topic', topic);
    if (query) gnewsParams.set('q', query);

    const targetEndpoint = (query || topic) ? GNEWS_SEARCH_URL : GNEWS_API_URL;
    const gnewsUrl = targetEndpoint + '?' + gnewsParams.toString(); 

    const response = await fetch(gnewsUrl);
    
    if (response.ok || (response.status !== 429 && response.status !== 403)) {
        return { status: response.status, response };
    }
    
    return { status: response.status, failed: true, message: `GNews API 错误 (${response.status})` };
}


// =========================================================
// API 函数 - 3. News API (Tertiary)
// =========================================================

async function fetchNewsFromNewsAPI(country, query, topic) {
    if (typeof NEWS_API_KEY === 'undefined' || NEWS_API_KEY.length < 5) {
        return { status: 500, failed: true, message: "News API Key 未配置" };
    }

    let newsApiParams = new URLSearchParams();
    newsApiParams.set('apiKey', NEWS_API_KEY);
    newsApiParams.set('sortBy', NEWSAPI_SORT);
    let targetUrl = NEWSAPI_URL;

    // 参数转换逻辑 (News API)
    if (query || topic) {
         targetUrl = NEWSAPI_SEARCH_URL;
         let fullQuery = query || "";
         if (topic) {
             const topicMap = { 'business': 'business', 'technology': 'technology', 'crypto': 'cryptocurrency OR bitcoin' };
             fullQuery += (fullQuery ? ' AND ' : '') + (topicMap[topic] || topic);
         }
         newsApiParams.set('q', fullQuery);
         if (country === 'cn' || country === 'hk') newsApiParams.set('language', 'zh');
    } else {
         if (country) newsApiParams.set('country', country);
         if (topic) newsApiParams.set('category', topic); 
    }
    
    const newsApiUrl = `${targetUrl}?${newsApiParams.toString()}`;
    
    try {
        const newsApiResponse = await fetch(newsApiUrl, { headers: NEWSAPI_HEADERS });

        if (newsApiResponse.ok) {
            return { status: newsApiResponse.status, response: newsApiResponse };
        } else {
            const errorData = await newsApiResponse.json().catch(() => ({}));
            let debugMessage = `News API 失败 (${newsApiResponse.status})。`;
            if (errorData.code && errorData.message) {
                 debugMessage = `News API 错误：[${errorData.code}] ${errorData.message}`;
            }
            return { status: newsApiResponse.status, failed: true, message: debugMessage };
        }
    } catch (e) {
        return { status: 503, failed: true, message: `News API 网络连接超时或 DNS 失败。` };
    }
}


// =========================================================
// 主入口函数
// =========================================================

async function handleRequest(request) {
    const url = new URL(request.url);
    
    const country = url.searchParams.get('country');
    const topic = url.searchParams.get('topic'); 
    const query = url.searchParams.get('q'); 

    let result;

    // --- 尝试 1：Bing News (Primary) ---
    result = await fetchNewsFromBing(country, query, topic);
    if (!result.failed) return buildResponse(result.response);

    console.log(`Bing News failed: ${result.message || 'Unknown'}. Attempting GNews.`);

    // --- 尝试 2：GNews (Secondary) ---
    // GNews API 函数需要国家/分类/搜索参数
    result = await fetchNewsFromGNews(country, query, topic); 
    if (!result.failed) return buildResponse(result.response);

    console.log(`GNews failed: ${result.message || 'Unknown'}. Attempting News API.`);

    // --- 尝试 3：News API (Tertiary) ---
    result = await fetchNewsFromNewsAPI(country, query, topic);
    if (!result.failed) return buildResponse(result.response);
    
    // 所有 API 源都失败
    return buildErrorResponse(`所有 API 源均失败。Bing/GNews/News API 错误: ${result.message}`, 503);
}
