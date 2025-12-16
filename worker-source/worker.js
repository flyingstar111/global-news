// Worker 代理代码 (Final Failover Edition - 修复 User-Agent 和排序)
const GNEWS_API_URL = 'https://gnews.io/api/v4/top-headlines';
const GNEWS_SEARCH_URL = 'https://gnews.io/api/v4/search';
const NEWSAPI_URL = 'https://newsapi.org/v2/top-headlines'; 
const NEWSAPI_SEARCH_URL = 'https://newsapi.org/v2/everything'; 

// News API 要求 User-Agent 头部
const NEWSAPI_HEADERS = {
    'User-Agent': 'news-aggregator-app-v1' 
};

// 【核心排序值】：最新的在最上面
const GNEWS_SORT = 'publishedAt'; // GNews 使用 publishedAt 排序
const NEWSAPI_SORT = 'publishedAt'; // News API 也是用 publishedAt 排序

// 【入口点修复】：确保 Worker 能够运行
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});


// 辅助函数：处理 CORS 和 Headers
const buildResponse = (response) => {
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Access-Control-Allow-Origin', '*'); 
    newHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    newHeaders.delete('Content-Encoding'); 
    newHeaders.delete('Content-Length'); 
    newHeaders.delete('Transfer-Encoding');

    return new Response(response.body, { status: response.status, headers: newHeaders });
};

// 辅助函数：构建错误响应
const buildErrorResponse = (message, status = 503) => {
    return new Response(JSON.stringify({ 
        errors: [{ message: message }] 
    }), { status: status, headers: { 'Access-Control-Allow-Origin': '*' } });
};


async function fetchNewsFromGNews(queryParams, query) {
    // GNews 排序逻辑：在查询参数中加入排序指令
    let gnewsQueryParams = new URLSearchParams(queryParams);
    gnewsQueryParams.set('sortby', GNEWS_SORT); // 强制 GNews 按照时间排序
    
    const targetEndpoint = query ? GNEWS_SEARCH_URL : GNEWS_API_URL;
    const gnewsUrl = targetEndpoint + '?' + gnewsQueryParams.toString(); // 重建 URL

    const response = await fetch(gnewsUrl);
    
    if (response.ok || (response.status !== 429 && response.status !== 403)) {
        return { status: response.status, response };
    }
    
    return { status: response.status, failed: true };
}


async function fetchNewsFromNewsAPI(country, query, topic) {
    if (typeof NEWS_API_KEY === 'undefined' || NEWS_API_KEY.length < 5) {
        return { status: 500, failed: true, message: "News API Key 未配置" };
    }

    let newsApiParams = new URLSearchParams();
    newsApiParams.set('apiKey', NEWS_API_KEY);
    
    // 【核心排序修复】：News API 使用 sortBy 参数
    newsApiParams.set('sortBy', NEWSAPI_SORT); // 强制 News API 按照时间排序
    
    let targetUrl = NEWSAPI_URL;

    // 参数转换逻辑 (News API)
    if (query || topic) {
         targetUrl = NEWSAPI_SEARCH_URL;
         let fullQuery = query || "";
         if (topic) {
             fullQuery += (fullQuery ? ' AND ' : '') + topic;
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


async function handleRequest(request) {
    const url = new URL(request.url);
    const queryParams = url.search;
    
    const country = url.searchParams.get('country');
    const query = url.searchParams.get('q');
    const topic = url.searchParams.get('topic'); 

    let result;

    // --- 尝试 1：GNews (主接口) ---
    result = await fetchNewsFromGNews(queryParams, query);

    if (result.failed) {
        // --- 尝试 2：News API (故障转移) ---
        result = await fetchNewsFromNewsAPI(country, query, topic);
        
        if (result.failed) {
             return buildErrorResponse(`GNews 失败。故障转移失败：${result.message}`, 503);
        }
    }
    
    const response = result.response;
    return buildResponse(response);
}
