import { handler } from "../src/index";
import {
  presets,
  createMockApiGatewayEvent,
  expectValidLambdaResponse,
  parseJsonResponse,
  expectHtmlResponse,
} from "./test-utils";

describe("Example Tests Using Test Utils", () => {
  describe("Using Preset Events", () => {
    it("should handle root page using preset", async () => {
      const event = presets.rootPage();
      const result = await handler(event);

      expectHtmlResponse(result);
      expect(result.statusCode).toBe(200);
    });

    it("should handle API info using preset", async () => {
      const event = presets.apiInfo();
      const result = await handler(event);

      const body = parseJsonResponse(result);
      expect(body.message).toBe("Hello from /api/info");
      expect(body).toHaveProperty("now");
    });

    it("should handle 404 using preset", async () => {
      const event = presets.notFound("/does-not-exist");
      const result = await handler(event);

      const body = parseJsonResponse(result);
      expect(result.statusCode).toBe(404);
      expect(body.error).toBe("Not Found");
      expect(body.path).toBe("/does-not-exist");
    });
  });

  describe("Using Custom Event Creation", () => {
    it("should handle custom headers", async () => {
      const event = createMockApiGatewayEvent({
        rawPath: "/api/info",
        headers: {
          "x-custom-header": "test-value",
          accept: "application/json",
        },
      });

      const result = await handler(event);
      expectValidLambdaResponse(result);
      expect(result.statusCode).toBe(200);
    });

    it("should handle query parameters", async () => {
      const event = createMockApiGatewayEvent({
        rawPath: "/api/info",
        queryStringParameters: {
          test: "value",
          foo: "bar",
        },
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });

    it("should handle different user agents", async () => {
      const event = createMockApiGatewayEvent({
        rawPath: "/api/info",
        userAgent: "TestBot/1.0",
      });

      const result = await handler(event);
      const body = parseJsonResponse(result);
      expect(body.userAgent).toBe("TestBot/1.0");
    });
  });

  describe("Response Validation Helpers", () => {
    it("should validate response structure", async () => {
      const event = presets.rootPage();
      const result = await handler(event);

      // This helper validates the basic Lambda response structure
      expectValidLambdaResponse(result);
    });

    it("should parse JSON responses safely", async () => {
      const event = presets.apiInfo();
      const result = await handler(event);

      // This helper validates JSON content-type and parses the body
      const body = parseJsonResponse(result);
      expect(body).toBeInstanceOf(Object);
    });

    it("should validate HTML responses", async () => {
      const event = presets.rootPage();
      const result = await handler(event);

      // This helper validates HTML content-type and basic HTML structure
      expectHtmlResponse(result);
    });
  });
});
