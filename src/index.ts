import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

const html = /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Lambda API Example</title>
  <!-- Tailwind via CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-gray-50 text-gray-900">
  <main class="max-w-2xl mx-auto p-4">
    <header class="mb-6 text-center">
      <h1 class="text-2xl font-bold">Hello from AWS Lambda deployed by Dagger! 👋</h1>
      <p class="text-gray-600 mt-2">This page is served by a Lambda Function URL.<br />Click the button to call the API.</p>
    </header>

    <section class="bg-white shadow rounded-2xl p-6 text-center">
      <button id="btn" class="px-4 py-2 rounded-xl shadow hover:shadow-md border w-full sm:w-auto">
        Call API
      </button>

      <pre id="out" class="text-left mt-4 p-4 bg-gray-100 rounded overflow-x-auto text-sm"></pre>
    </section>

    <footer class="mt-8 text-xs text-center text-gray-500">
      Source code available at <a href="https://github.com/jasonmccallister/lambda-api-example" class="text-blue-500 hover:underline">GitHub</a>.
    </footer>
  </main>

  <script>
    const out = document.getElementById('out');
    const btn = document.getElementById('btn');
    btn.addEventListener('click', async () => {
      out.textContent = 'Loading...';
      try {
        const res = await fetch('/api/info', { headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        out.textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        out.textContent = 'Error: ' + (e?.message || e);
      }
    });
  </script>
</body>
</html>`;

function resp(
  statusCode: number,
  body: string,
  contentType: string
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
      // CORS (useful if you later call from another origin)
      "access-control-allow-origin": "*",
    },
    body,
  };
}

export async function handler(
  event: any
): Promise<APIGatewayProxyStructuredResultV2> {
  // Function URL uses HTTP v2 event with rawPath, method in requestContext.http.method
  const rawPath: string = event.rawPath || "/";
  const method: string = event.requestContext?.http?.method || "GET";

  if (method === "GET" && (rawPath === "/" || rawPath === "")) {
    return resp(200, html, "text/html; charset=utf-8");
  }

  if (method === "GET" && rawPath === "/api/info") {
    const info = {
      message: "Hello from /api/info",
      now: new Date().toISOString(),
      requestId: event.requestContext?.requestId,
      ip: event.requestContext?.http?.sourceIp,
      userAgent: event.requestContext?.http?.userAgent,
    };
    return resp(200, JSON.stringify(info), "application/json; charset=utf-8");
  }

  // Simple 404
  return resp(
    404,
    JSON.stringify({ error: "Not Found", path: rawPath }),
    "application/json; charset=utf-8"
  );
}
