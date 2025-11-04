/**
 * Replace 
 * https://uniquepetswiki.com/wp-content/uploads/...
 * with
 * https://media.uniquepetswiki.com/uploads/...
 * 
 * Cloudflare Worker to route media requests to GitHub repository
 * 
 * Handles requests from: media.uniquepetswiki.com/uploads/...
 * Routes to GitHub repository based on year/quarter:
 * 
 * Options:
 * 1. Raw GitHub URLs: https://raw.githubusercontent.com/username/repo/branch/path
 * 2. GitHub Pages: https://username.github.io/repo/path (if Pages enabled)
 * 3. jsDelivr CDN: https://cdn.jsdelivr.net/gh/username/repo@branch/path (recommended - fastest)
 * 
 * Configure these variables:
 */
const GITHUB_USERNAME = 'crabvn'; // Your GitHub username
const GITHUB_REPO = 'uniquepetswiki-uploads'; // Your repository name
const GITHUB_BRANCH = 'main'; // Branch name (main, master, etc.)

// Choose hosting method:
// 'raw' - Raw GitHub URLs (slower, direct)
// 'pages' - GitHub Pages (if enabled, requires custom domain setup)
// 'jsdelivr' - jsDelivr CDN (recommended - fastest, free CDN)
const HOSTING_METHOD = 'jsdelivr';

// Base URLs for different hosting methods
const BASE_URLS = {
    raw: `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${GITHUB_REPO}/${GITHUB_BRANCH}`,
    pages: `https://${GITHUB_USERNAME}.github.io/${GITHUB_REPO}`,
    jsdelivr: `https://cdn.jsdelivr.net/gh/${GITHUB_USERNAME}/${GITHUB_REPO}@${GITHUB_BRANCH}`
};

/**
 * Get the base URL for media files
 */
function getBaseUrl() {
    return BASE_URLS[HOSTING_METHOD] || BASE_URLS.jsdelivr;
}

/**
 * Convert /uploads/... path to GitHub repository path
 * 
 * If you init git in wp-content/uploads/, the repo root is the uploads folder
 * So: /uploads/2020/01/image.jpg → 2020/01/image.jpg
 */
function getGitHubPath(path) {
    // Remove leading /uploads/ - that's it!
    // Input: /uploads/2020/01/image.jpg
    // Output: 2020/01/image.jpg
    return path.replace(/^\/uploads\//, '');
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // Only handle /uploads/* requests
        if (!url.pathname.startsWith('/uploads/')) {
            return new Response('Not Found', { status: 404 });
        }

        // Get the GitHub path
        const githubPath = getGitHubPath(url.pathname);
        const baseUrl = getBaseUrl();

        // Build the target URL - jsDelivr needs the path without leading slash
        // Format: https://cdn.jsdelivr.net/gh/user/repo@branch/path/to/file
        const cleanPath = githubPath.startsWith('/') ? githubPath.substring(1) : githubPath;
        const targetUrlString = baseUrl.endsWith('/')
            ? `${baseUrl}${cleanPath}`
            : `${baseUrl}/${cleanPath}`;
        const targetUrl = new URL(targetUrlString);
        targetUrl.search = url.search; // Preserve query parameters

        // Create new request with same method and headers
        const newRequest = new Request(targetUrl.toString(), {
            method: request.method,
            headers: {
                ...Object.fromEntries(request.headers),
                'User-Agent': 'Mozilla/5.0 (compatible; CloudflareWorker/1.0)',
            },
            body: request.body,
        });

        try {
            // Fetch from GitHub
            const response = await fetch(newRequest);

            // If GitHub returns 404, try alternative path format (if repo has wp-content/uploads structure)
            if (response.status === 404) {
                const altPath = 'wp-content' + url.pathname; // Try with wp-content/uploads/ prefix
                const cleanAltPath = altPath.startsWith('/') ? altPath.substring(1) : altPath;
                const altUrlString = baseUrl.endsWith('/')
                    ? `${baseUrl}${cleanAltPath}`
                    : `${baseUrl}/${cleanAltPath}`;
                const altUrl = new URL(altUrlString);
                altUrl.search = url.search;

                const altRequest = new Request(altUrl.toString(), {
                    method: request.method,
                    headers: {
                        ...Object.fromEntries(request.headers),
                        'User-Agent': 'Mozilla/5.0 (compatible; CloudflareWorker/1.0)',
                    },
                });

                const altResponse = await fetch(altRequest);
                if (altResponse.status === 200) {
                    return new Response(altResponse.body, {
                        status: altResponse.status,
                        statusText: altResponse.statusText,
                        headers: {
                            ...Object.fromEntries(altResponse.headers),
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                            'Cache-Control': 'public, max-age=31536000, immutable',
                        },
                    });
                }
            }

            // Create new response with CORS headers
            const newResponse = new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: {
                    ...Object.fromEntries(response.headers),
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                    'Cache-Control': 'public, max-age=31536000, immutable',
                },
            });

            return newResponse;
        } catch (error) {
            return new Response(`Error fetching from GitHub: ${error.message}`, {
                status: 500
            });
        }
    },
};
