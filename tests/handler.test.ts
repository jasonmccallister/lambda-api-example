import { handler } from "../src/index";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";

// Mock context object for Lambda
const mockContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: "test-function",
  functionVersion: "1",
  invokedFunctionArn:
    "arn:aws:lambda:us-east-1:123456789012:function:test-function",
  memoryLimitInMB: "128",
  awsRequestId: "test-request-id",
  logGroupName: "/aws/lambda/test-function",
  logStreamName: "2023/08/26/[$LATEST]test-stream",
  getRemainingTimeInMillis: () => 30000,
  done: () => {},
  fail: () => {},
  succeed: () => {},
};

// Helper function to create mock API Gateway events
function createMockEvent(
  rawPath: string = "/",
  method: string = "GET",
  headers: Record<string, string> = {},
  queryStringParameters: Record<string, string> = {}
): any {
  return {
    rawPath,
    queryStringParameters,
    headers,
    requestContext: {
      accountId: "123456789012",
      apiId: "test-api-id",
      domainName: "example.com",
      domainPrefix: "test",
      stage: "$default",
      requestId: "test-request-123",
      routeKey: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
      http: {
        method,
        path: rawPath,
        protocol: "HTTP/1.1",
        sourceIp: "192.168.1.1",
        userAgent: "Mozilla/5.0 (Test Browser)",
      },
    },
  };
}

describe("Lambda Handler", () => {
  beforeEach(() => {
    // Reset any mocks or global state before each test
    jest.clearAllMocks();
  });

  describe("GET / (root path)", () => {
    it("should return HTML content for root path", async () => {
      const event = createMockEvent("/", "GET");
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.headers!["content-type"]).toBe("text/html; charset=utf-8");
      expect(result.body).toContain("<!doctype html>");
      expect(result.body).toContain(
        "Hello from AWS Lambda deployed by Dagger! 👋"
      );
      expect(result.body).toContain(
        "This page is served by a Lambda Function URL"
      );
    });

    it("should return HTML content for empty path", async () => {
      const event = createMockEvent("", "GET");
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.headers!["content-type"]).toBe("text/html; charset=utf-8");
      expect(result.body).toContain("<!doctype html>");
    });

    it("should include CORS headers", async () => {
      const event = createMockEvent("/", "GET");
      const result = await handler(event);

      expect(result.headers!["access-control-allow-origin"]).toBe("*");
      expect(result.headers!["cache-control"]).toBe("no-store");
    });
  });

  describe("GET /api/info", () => {
    it("should return JSON info for /api/info endpoint", async () => {
      const event = createMockEvent("/api/info", "GET");
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.headers!["content-type"]).toBe(
        "application/json; charset=utf-8"
      );

      const body = JSON.parse(result.body!);
      expect(body).toHaveProperty("message", "Hello from /api/info");
      expect(body).toHaveProperty("now");
      expect(body).toHaveProperty("requestId", "test-request-123");
      expect(body).toHaveProperty("ip", "192.168.1.1");
      expect(body).toHaveProperty("userAgent", "Mozilla/5.0 (Test Browser)");
    });

    it("should return current timestamp in ISO format", async () => {
      const beforeTime = Date.now();
      const event = createMockEvent("/api/info", "GET");
      const result = await handler(event);
      const afterTime = Date.now();

      const body = JSON.parse(result.body!);
      expect(new Date(body.now).toISOString()).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );
      const responseTime = new Date(body.now).getTime();
      expect(responseTime).toBeGreaterThanOrEqual(beforeTime);
      expect(responseTime).toBeLessThanOrEqual(afterTime);
    });

    it("should include request context information", async () => {
      const event = createMockEvent("/api/info", "GET");
      const result = await handler(event);

      const body = JSON.parse(result.body!);
      expect(body.requestId).toBe("test-request-123");
      expect(body.ip).toBe("192.168.1.1");
      expect(body.userAgent).toBe("Mozilla/5.0 (Test Browser)");
    });

    it("should include CORS headers", async () => {
      const event = createMockEvent("/api/info", "GET");
      const result = await handler(event);

      expect(result.headers!["access-control-allow-origin"]).toBe("*");
      expect(result.headers!["cache-control"]).toBe("no-store");
    });
  });

  describe("404 Not Found", () => {
    it("should return 404 for unknown paths", async () => {
      const event = createMockEvent("/unknown/path", "GET");
      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      expect(result.headers!["content-type"]).toBe(
        "application/json; charset=utf-8"
      );

      const body = JSON.parse(result.body!);
      expect(body).toHaveProperty("error", "Not Found");
      expect(body).toHaveProperty("path", "/unknown/path");
    });

    it("should return 404 for unsupported HTTP methods", async () => {
      const event = createMockEvent("/", "POST");
      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      expect(result.headers!["content-type"]).toBe(
        "application/json; charset=utf-8"
      );

      const body = JSON.parse(result.body!);
      expect(body).toHaveProperty("error", "Not Found");
      expect(body).toHaveProperty("path", "/");
    });

    it("should return 404 for POST to /api/info", async () => {
      const event = createMockEvent("/api/info", "POST");
      const result = await handler(event);

      expect(result.statusCode).toBe(404);

      const body = JSON.parse(result.body!);
      expect(body).toHaveProperty("error", "Not Found");
      expect(body).toHaveProperty("path", "/api/info");
    });
  });

  describe("Edge Cases", () => {
    it("should handle missing requestContext", async () => {
      const event = {
        rawPath: "/",
        // Missing requestContext
      };
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.headers!["content-type"]).toBe("text/html; charset=utf-8");
    });

    it("should handle missing rawPath", async () => {
      const event = {
        requestContext: {
          http: {
            method: "GET",
          },
        },
      };
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.headers!["content-type"]).toBe("text/html; charset=utf-8");
    });

    it("should handle missing HTTP method", async () => {
      const event = {
        rawPath: "/",
        requestContext: {
          // Missing http.method
        },
      };
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.headers!["content-type"]).toBe("text/html; charset=utf-8");
    });

    it("should handle undefined event properties gracefully for /api/info", async () => {
      const event = {
        rawPath: "/api/info",
        requestContext: {
          http: {
            method: "GET",
            // Missing sourceIp, userAgent
          },
          // Missing requestId
        },
      };
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body!);
      expect(body).toHaveProperty("message", "Hello from /api/info");
      expect(body).toHaveProperty("now");
      expect(body.requestId).toBeUndefined();
      expect(body.ip).toBeUndefined();
      expect(body.userAgent).toBeUndefined();
    });
  });

  describe("Response Structure", () => {
    it("should always return proper API Gateway response structure", async () => {
      const event = createMockEvent("/", "GET");
      const result = await handler(event);

      expect(result).toHaveProperty("statusCode");
      expect(result).toHaveProperty("headers");
      expect(result).toHaveProperty("body");
      expect(typeof result.statusCode).toBe("number");
      expect(typeof result.headers).toBe("object");
      expect(typeof result.body).toBe("string");
    });

    it("should include required headers in all responses", async () => {
      const testCases = [
        createMockEvent("/", "GET"),
        createMockEvent("/api/info", "GET"),
        createMockEvent("/unknown", "GET"),
      ];

      for (const event of testCases) {
        const result = await handler(event);

        expect(result.headers).toHaveProperty("content-type");
        expect(result.headers).toHaveProperty("cache-control", "no-store");
        expect(result.headers).toHaveProperty(
          "access-control-allow-origin",
          "*"
        );
      }
    });
  });
});
