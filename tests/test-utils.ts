import type { APIGatewayProxyEventV2 } from "aws-lambda";

/**
 * Test utilities for creating mock AWS Lambda events and contexts
 */

export interface MockEventOptions {
  rawPath?: string;
  method?: string;
  headers?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  requestId?: string;
  sourceIp?: string;
  userAgent?: string;
  body?: string;
  isBase64Encoded?: boolean;
}

/**
 * Creates a mock API Gateway v2 event for testing
 */
export function createMockApiGatewayEvent(options: MockEventOptions = {}): any {
  const {
    rawPath = "/",
    method = "GET",
    headers = {},
    queryStringParameters = {},
    requestId = "test-request-123",
    sourceIp = "192.168.1.1",
    userAgent = "Mozilla/5.0 (Test Browser)",
    body = "",
    isBase64Encoded = false,
  } = options;

  return {
    version: "2.0",
    routeKey: "$default",
    rawPath,
    rawQueryString: new URLSearchParams(queryStringParameters).toString(),
    headers: {
      host: "test-function-url.lambda-url.us-east-1.on.aws",
      "user-agent": userAgent,
      accept: "*/*",
      ...headers,
    },
    queryStringParameters:
      Object.keys(queryStringParameters).length > 0
        ? queryStringParameters
        : undefined,
    requestContext: {
      accountId: "123456789012",
      apiId: "test-api-id",
      domainName: "test-function-url.lambda-url.us-east-1.on.aws",
      domainPrefix: "test-function-url",
      http: {
        method,
        path: rawPath,
        protocol: "HTTP/1.1",
        sourceIp,
        userAgent,
      },
      requestId,
      routeKey: "$default",
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    body: body || undefined,
    isBase64Encoded,
  };
}

/**
 * Creates a mock Lambda context for testing
 */
export function createMockContext(options: Partial<any> = {}): any {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: "test-function",
    functionVersion: "$LATEST",
    invokedFunctionArn:
      "arn:aws:lambda:us-east-1:123456789012:function:test-function",
    memoryLimitInMB: "128",
    awsRequestId: "test-aws-request-id",
    logGroupName: "/aws/lambda/test-function",
    logStreamName: "2023/08/26/[$LATEST]test-stream",
    getRemainingTimeInMillis: () => 30000,
    done: jest.fn(),
    fail: jest.fn(),
    succeed: jest.fn(),
    ...options,
  };
}

/**
 * Preset event creators for common scenarios
 */
export const presets = {
  /**
   * Creates a mock event for the root path (GET /)
   */
  rootPage: (overrides: MockEventOptions = {}) =>
    createMockApiGatewayEvent({ rawPath: "/", method: "GET", ...overrides }),

  /**
   * Creates a mock event for the API info endpoint (GET /api/info)
   */
  apiInfo: (overrides: MockEventOptions = {}) =>
    createMockApiGatewayEvent({
      rawPath: "/api/info",
      method: "GET",
      ...overrides,
    }),

  /**
   * Creates a mock event for a 404 scenario
   */
  notFound: (path: string = "/unknown", overrides: MockEventOptions = {}) =>
    createMockApiGatewayEvent({ rawPath: path, method: "GET", ...overrides }),

  /**
   * Creates a mock event with JSON accept header
   */
  withJsonAccept: (overrides: MockEventOptions = {}) =>
    createMockApiGatewayEvent({
      headers: { accept: "application/json" },
      ...overrides,
    }),

  /**
   * Creates a mock POST event
   */
  postRequest: (
    rawPath: string = "/",
    body: string = "",
    overrides: MockEventOptions = {}
  ) =>
    createMockApiGatewayEvent({
      rawPath,
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      ...overrides,
    }),
};

/**
 * Helper to assert Lambda response structure
 */
export function expectValidLambdaResponse(response: any) {
  expect(response).toHaveProperty("statusCode");
  expect(response).toHaveProperty("headers");
  expect(response).toHaveProperty("body");
  expect(typeof response.statusCode).toBe("number");
  expect(typeof response.headers).toBe("object");
  expect(typeof response.body).toBe("string");
}

/**
 * Helper to parse and validate JSON response
 */
export function parseJsonResponse(response: any) {
  expectValidLambdaResponse(response);
  expect(response.headers!["content-type"]).toContain("application/json");
  return JSON.parse(response.body!);
}

/**
 * Helper to validate HTML response
 */
export function expectHtmlResponse(response: any) {
  expectValidLambdaResponse(response);
  expect(response.headers!["content-type"]).toContain("text/html");
  expect(response.body).toContain("<!doctype html>");
}
