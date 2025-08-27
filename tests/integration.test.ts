import { handler } from "../src/index";

// Real AWS API Gateway v2 event structure for integration testing
const realApiGatewayEvent = {
  version: "2.0",
  routeKey: "$default",
  rawPath: "/api/info",
  rawQueryString: "",
  headers: {
    accept: "application/json",
    "accept-encoding": "gzip, deflate, br",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    "content-length": "0",
    host: "your-function-url.lambda-url.us-east-1.on.aws",
    pragma: "no-cache",
    "sec-ch-ua":
      '"Chromium";v="110", "Not A(Brand";v="24", "Google Chrome";v="110"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "cross-site",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
    "x-amzn-trace-id": "Root=1-64029d0a-1234567890abcdef12345678",
    "x-forwarded-for": "198.51.100.1",
    "x-forwarded-port": "443",
    "x-forwarded-proto": "https",
  },
  requestContext: {
    accountId: "123456789012",
    apiId: "your-api-id",
    domainName: "your-function-url.lambda-url.us-east-1.on.aws",
    domainPrefix: "your-function-url",
    http: {
      method: "GET",
      path: "/api/info",
      protocol: "HTTP/1.1",
      sourceIp: "198.51.100.1",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
    },
    requestId: "abc123de-f456-7890-abcd-ef1234567890",
    routeKey: "$default",
    stage: "$default",
    time: "03/Mar/2023:10:15:38 +0000",
    timeEpoch: 1677578138000,
  },
  isBase64Encoded: false,
};

describe("Integration Tests", () => {
  describe("Real AWS Event Structure", () => {
    it("should handle real API Gateway v2 event for /api/info", async () => {
      const result = await handler(realApiGatewayEvent);

      expect(result.statusCode).toBe(200);
      expect(result.headers!["content-type"]).toBe(
        "application/json; charset=utf-8"
      );
      expect(result.headers!["access-control-allow-origin"]).toBe("*");

      const body = JSON.parse(result.body!);
      expect(body.message).toBe("Hello from /api/info");
      expect(body.requestId).toBe("abc123de-f456-7890-abcd-ef1234567890");
      expect(body.ip).toBe("198.51.100.1");
      expect(body.userAgent).toContain("Chrome/110.0.0.0");
    });

    it("should handle real API Gateway v2 event for root path", async () => {
      const rootEvent = {
        ...realApiGatewayEvent,
        rawPath: "/",
        requestContext: {
          ...realApiGatewayEvent.requestContext,
          http: {
            ...realApiGatewayEvent.requestContext.http,
            path: "/",
          },
        },
      };

      const result = await handler(rootEvent);

      expect(result.statusCode).toBe(200);
      expect(result.headers!["content-type"]).toBe("text/html; charset=utf-8");
      expect(result.body).toContain("<!doctype html>");
      expect(result.body).toContain(
        "Hello from AWS Lambda deployed by Dagger! 👋"
      );
    });

    it("should handle POST method returning 404", async () => {
      const postEvent = {
        ...realApiGatewayEvent,
        requestContext: {
          ...realApiGatewayEvent.requestContext,
          http: {
            ...realApiGatewayEvent.requestContext.http,
            method: "POST",
          },
        },
      };

      const result = await handler(postEvent);

      expect(result.statusCode).toBe(404);
      expect(result.headers!["content-type"]).toBe(
        "application/json; charset=utf-8"
      );

      const body = JSON.parse(result.body!);
      expect(body.error).toBe("Not Found");
      expect(body.path).toBe("/api/info");
    });
  });

  describe("Performance Tests", () => {
    it("should handle multiple concurrent requests", async () => {
      const promises = Array.from({ length: 10 }, () =>
        handler({
          ...realApiGatewayEvent,
          requestContext: {
            ...realApiGatewayEvent.requestContext,
            requestId: `request-${Math.random().toString(36).substr(2, 9)}`,
          },
        })
      );

      const results = await Promise.all(promises);

      // All requests should succeed
      results.forEach((result) => {
        expect(result.statusCode).toBe(200);
        expect(result.headers!["content-type"]).toBe(
          "application/json; charset=utf-8"
        );
      });

      // Each should have unique request ID
      const requestIds = results.map((r) => JSON.parse(r.body!).requestId);
      const uniqueRequestIds = new Set(requestIds);
      expect(uniqueRequestIds.size).toBe(10);
    });

    it("should respond quickly", async () => {
      const startTime = Date.now();
      await handler(realApiGatewayEvent);
      const endTime = Date.now();

      // Should respond in less than 100ms
      expect(endTime - startTime).toBeLessThan(100);
    });
  });
});
