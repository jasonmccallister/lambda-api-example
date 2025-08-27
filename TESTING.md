# Testing Guide

This project uses **Jest** as the testing framework with comprehensive TypeScript support.

## Test Structure

```
tests/
├── handler.test.ts           # Main unit tests for the Lambda handler
├── integration.test.ts       # Integration tests with real AWS event structures
├── example-with-utils.test.ts # Example tests showing how to use test utilities
└── test-utils.ts            # Reusable test utilities and helpers
```

## Running Tests

```bash
# Run all tests
yarn test

# Run tests in watch mode (re-runs on file changes)
yarn run test:watch

# Run tests with coverage report
yarn run test:coverage

# Run tests in CI mode (no watch, with coverage)
yarn run test:ci
```

## Test Coverage

The test suite provides 100% code coverage of the Lambda handler, testing:

- ✅ **Route Handling**: Root path (`/`) and API endpoint (`/api/info`)
- ✅ **HTTP Methods**: GET requests and 404 for unsupported methods
- ✅ **Response Structure**: Proper API Gateway response format
- ✅ **Headers**: CORS headers, content-type, cache-control
- ✅ **Edge Cases**: Missing request context, malformed events
- ✅ **Error Handling**: 404 responses for unknown paths
- ✅ **Integration**: Real AWS API Gateway event structures
- ✅ **Performance**: Concurrent request handling and response time

## Test Utilities

The `test-utils.ts` file provides helpful utilities for creating test events:

### Event Presets

```typescript
import { presets } from "./test-utils";

// Root page request
const rootEvent = presets.rootPage();

// API info request
const apiEvent = presets.apiInfo();

// 404 request
const notFoundEvent = presets.notFound("/unknown-path");

// POST request
const postEvent = presets.postRequest("/", '{"data": "value"}');
```

### Custom Event Creation

```typescript
import { createMockApiGatewayEvent } from "./test-utils";

const customEvent = createMockApiGatewayEvent({
  rawPath: "/custom",
  method: "GET",
  headers: { authorization: "Bearer token" },
  queryStringParameters: { param: "value" },
  userAgent: "CustomBot/1.0",
});
```

### Response Validation Helpers

```typescript
import {
  expectValidLambdaResponse,
  parseJsonResponse,
  expectHtmlResponse,
} from "./test-utils";

// Validate basic Lambda response structure
expectValidLambdaResponse(result);

// Parse and validate JSON responses
const body = parseJsonResponse(result);

// Validate HTML responses
expectHtmlResponse(result);
```

## Example Tests

### Basic Handler Test

```typescript
import { handler } from "../src/index";
import { presets, parseJsonResponse } from "./test-utils";

test("should return API info", async () => {
  const event = presets.apiInfo();
  const result = await handler(event);

  const body = parseJsonResponse(result);
  expect(body.message).toBe("Hello from /api/info");
});
```

### Edge Case Test

```typescript
test("should handle missing request context", async () => {
  const event = { rawPath: "/" }; // Minimal event
  const result = await handler(event);

  expect(result.statusCode).toBe(200);
});
```

### Integration Test

```typescript
test("should handle real AWS event", async () => {
  const realEvent = {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/api/info",
    requestContext: {
      accountId: "123456789012",
      http: {
        method: "GET",
        sourceIp: "192.168.1.1",
      },
    },
  };

  const result = await handler(realEvent);
  expect(result.statusCode).toBe(200);
});
```

## Jest Configuration

The Jest configuration (`jest.config.js`) is set up for:

- ✅ **ESM Support**: Handles ES modules with TypeScript
- ✅ **TypeScript**: Uses ts-jest for TypeScript compilation
- ✅ **Coverage**: Collects coverage from `src/` directory
- ✅ **Module Resolution**: Handles `.js` imports in TypeScript

## Best Practices

1. **Test Structure**: Use `describe` blocks to group related tests
2. **Test Names**: Use descriptive test names that explain the scenario
3. **Assertions**: Use specific assertions (e.g., `toBe` vs `toEqual`)
4. **Mocking**: Use the provided utilities for consistent mock events
5. **Coverage**: Aim for 100% code coverage
6. **Edge Cases**: Test missing/undefined properties
7. **Integration**: Include tests with real AWS event structures

## CI/CD Integration

For continuous integration, use:

```bash
yarn run test:ci
```

This runs tests once with coverage reporting, suitable for CI environments.
