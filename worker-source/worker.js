// Worker 代理代码 (Final Double Failover Edition - 修复 GNews 400 核心 Bug)
const GNEWS_API_URL = 'https://gnews.io/api/v4/top-headlines'; // 仅用于 topic/country
const GNEWS_SEARCH_URL = 'https://gnews.io/api/v4/search'; // 仅用于 q (query)
const NEWSAPI_URL = 'https://newsapi.org/v2/top-headlines'; 
const NEWSAPI_SEARCH_URL = 'https://newsapi.org/v2/everything'; 

// News API 要求 User-Agent 头部
const NEWSAPI_HEADERS = {
    'User-Agent': 'news-aggregator-app-v1' 
};
const GNEWS_SORT = 'publishedAt';
const NEWSAPI_SORT = 'publishedAt';

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
// API 函数 - 1. GNews (Primary)
// =========================================================

async function fetchNewsFromGNews(country, query, topic) {
    if (typeof GNEWS_API_KEY === 'undefined' || GNEWS_API_KEY.length < 5) {
        return { status: 500, failed: true, message: "GNews API Key 未配置" };
    }
    
    let gnewsParams = new URLSearchParams();
    gnewsParams.set('sortby', GNEWS_SORT); 
    gnewsParams.set('token', GNEWS_API_KEY); 

    if (country) gnewsParams.set('country', country);
    if (topic) gnewsParams.set('topic', topic);
    if (query) gnewsParams.set('q', query);

    // 【核心修复点】：根据参数精确选择 GNews 接口
    let targetEndpoint;
    
    if (query) {
        // 只有在明确搜索关键词 (crypto) 时，才使用 Search 接口
        targetEndpoint = GNEWS_SEARCH_URL;
        gnewsParams.delete('topic'); // Search 接口必须删除 topic
    } else if (topic) {
        // business, technology 等标准分类，必须使用 Top-Headlines 接口
        targetEndpoint = GNEWS_API_URL;
        gnewsParams.delete('q'); // Top-Headlines 接口必须删除 q
    } else {
        // general (综合头条)
        targetEndpoint = GNEWS_API_URL;
        gnewsParams.delete('q');
        gnewsParams.delete('topic');
    }


    // 避免 GNews 针对 CN/HK 的 topic 400 错误 (保留之前修复的逻辑)
    if ((country === 'cn' || country === 'hk') && topic) {
        gnewsParams.delete('country');
    }

    const gnewsUrl = targetEndpoint + '?' + gnewsParams.toString(); 

    const response = await fetch(gnewsUrl);
    
    if (response.ok || (response.status !== 429 && response.status !== 403)) {
        return { status: response.status, response };
    }
    
    // GNews 失败 (400, 429, 403)
    return { status: response.status, failed: true, message: `GNews API 错误 (${response.status})` };
}


// =========================================================
// API 函数 - 2. News API (Secondary)
// =========================================================
// (该函数保持不变，因为它在之前的修复中已经稳定)

async function fetchNewsFromNewsAPI(country, query, topic) {
    if (typeof NEWS_API_KEY === 'undefined' || NEWS_API_KEY.length < 5) {
        return { status: 500, failed: true, message: "News API Key 未配置" };
    }

    let newsApiParams = new URLSearchParams();
    newsApiParams.set('apiKey', NEWS_API_KEY);
    newsApiParams.set('sortBy', NEWSAPI_SORT);
    let targetUrl = NEWSAPI_URL;

    // 参数转换逻辑 (News API)
    if (query || (topic && topic !== 'business' && topic !== 'technology')) {
         targetUrl = NEWSAPI_SEARCH_URL;
         let fullQuery = query || "";
         if (topic) {
             const topicMap = { 'business': 'business', 'technology': 'technology', 'crypto': 'cryptocurrency OR bitcoin' };
             fullQuery += (fullQuery ? ' AND ' : '') + (topicMap[topic] || topic);
         }
         newsApiParams.set('q', fullQuery);
         if (country === 'cn' || country === 'hk') newsApiParams.set('language', 'zh');
    } else if (topic && (topic === 'business' || topic === 'technology')) {
         targetUrl = NEWSAPI_URL;
         if (country) newsApiParams.set('country', country);
         newsApiParams.set('category', topic); 
         
    } else {
         if (country) newsApiParams.set('country', country);
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
// 主入口函数 (保持不变)
// =========================================================

async function handleRequest(request) {
    const url = new URL(request.url);
    
    const country = url.searchParams.get('country');
    const topic = url.searchParams.get('topic'); 
    const query = url.searchParams.get('q'); 

    let result;

    // --- 尝试 1：GNews (Primary) ---
    result = await fetchNewsFromGNews(country, query, topic);
    if (!result.failed) return buildResponse(result.response);

    console.log(`GNews failed: ${result.message || 'Unknown'}. Attempting News API.`);

    // --- 尝试 2：News API (Secondary) ---
    result = await fetchNewsFromNewsAPI(country, query, topic);
    if (!result.failed) return buildResponse(result.response);
    
    // 所有 API 源都失败
    return buildErrorResponse(`所有 API 源均失败。GNews/News API 错误: ${result.message}`, 503);
}
