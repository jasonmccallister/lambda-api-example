import {
  AddPermissionCommand,
  Architecture,
  CreateFunctionCommand,
  CreateFunctionUrlConfigCommand,
  DeleteFunctionCommand,
  DeleteFunctionUrlConfigCommand,
  GetFunctionCommand,
  GetFunctionUrlConfigCommand,
  Runtime,
  UpdateFunctionCodeCommand,
} from "@aws-sdk/client-lambda";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { File, object, func, Secret } from "@dagger.io/dagger";
import { readFileSync } from "fs";

@object()
export class AwsLambda {
  private accessKey: Secret;
  private secretKey: Secret;
  private sessionToken?: Secret;
  private region: string;

  constructor(
    accessKey: Secret,
    secretKey: Secret,
    region: string,
    sessionToken?: Secret
  ) {
    this.accessKey = accessKey;
    this.secretKey = secretKey;
    this.sessionToken = sessionToken;
    this.region = region;
  }

  /**
   * Creates a new Lambda function
   * @param functionName The name of the Lambda function
   * @param roleArn The ARN of the IAM role that Lambda assumes when it executes the function
   * @param handler The function within your code that Lambda calls to begin execution
   * @param runtime The runtime environment for the Lambda function
   * @param zipFile The zip file containing the function code
   * @param memorySize The amount of memory allocated to the function
   * @param timeout The amount of time that Lambda allows a function to run before stopping it
   * @param architecture The instruction set architecture that the function uses
   * @returns The ARN of the created Lambda function
   */
  @func()
  async create(
    functionName: string,
    roleArn: string,
    handler: string,
    runtime: string,
    zipFile: File,
    memorySize: number = 128,
    timeout: number = 30,
    architecture: string = "arm64"
  ): Promise<string> {
    const client = await this.getClient();

    // find the matching runtime const from the lambda module
    const matchingRuntime = Object.values(Runtime).find((r) => r === runtime);
    if (!matchingRuntime) {
      throw new Error(`Unsupported runtime: ${runtime}`);
    }

    // find the matching architecture const from the lambda module
    const matchingArchitecture = Object.values(Architecture).find(
      (a) => a === architecture
    );
    if (!matchingArchitecture) {
      throw new Error(`Unsupported architecture: ${architecture}`);
    }

    const response = await client.send(
      new CreateFunctionCommand({
        FunctionName: functionName,
        Role: roleArn,
        Handler: handler,
        MemorySize: memorySize,
        Timeout: timeout,
        Architectures: [matchingArchitecture],
        Runtime: matchingRuntime,
        Code: {
          ZipFile: await this.readZipFileBytes(zipFile),
        },
      })
    );

    if (!response.FunctionArn) {
      throw new Error("Failed to create Lambda function");
    }

    return response.FunctionArn;
  }

  /**
   * Creates a new function URL for a Lambda function
   * @param functionName The name of the Lambda function
   * @param authType The type of authentication to use for the function URL
   * @param allowedCorsOrigins The CORS origins to allow for the function URL
   * @param allowedCorsHeaders The CORS headers to allow for the function URL
   * @param allowedCorsMethods The CORS methods to allow for the function URL
   * @param allowCredentials Whether to allow credentials for the function URL
   * @returns The URL of the created function
   */
  @func()
  async createFunctionUrl(
    functionName: string,
    authType: string = "NONE",
    allowedCorsOrigins: string[] = ["*"],
    allowedCorsHeaders: string[] = ["*"],
    allowedCorsMethods: string[] = ["*"],
    allowCredentials: boolean = false
  ): Promise<string> {
    const client = await this.getClient();

    try {
      let functionUrl = await this.functionUrlExists(functionName);
      if (functionUrl) {
        return functionUrl;
      }
    } catch (error: any) {
      // Function URL doesn't exist if we get ResourceNotFound error
      if (error.name !== "ResourceNotFoundException") {
        throw error;
      }
    }

    // Create function URL if it doesn't exist
    const create = await client.send(
      new CreateFunctionUrlConfigCommand({
        FunctionName: functionName,
        AuthType: authType as "NONE" | "AWS_IAM",
        Cors: {
          AllowOrigins: allowedCorsOrigins,
          AllowMethods: allowedCorsMethods,
          AllowHeaders: allowedCorsHeaders,
          AllowCredentials: allowCredentials,
        },
      })
    );

    if (!create.FunctionUrl) {
      throw new Error("Failed to create function URL - no URL returned");
    }

    // Add permission so the URL is callable by anyone (public)
    try {
      await client.send(
        new AddPermissionCommand({
          FunctionName: functionName,
          StatementId: "public-url",
          Action: "lambda:InvokeFunctionUrl",
          Principal: "*",
          FunctionUrlAuthType: authType as "NONE" | "AWS_IAM",
        })
      );
    } catch (error: any) {
      // Ignore if permission already exists
      if (error.name !== "ResourceConflictException") {
        throw error;
      }
    }

    return create.FunctionUrl;
  }

  /**
   * Removes a Lambda function
   * @param functionName The name of the Lambda function to remove
   */
  @func()
  async remove(functionName: string): Promise<void> {
    const client = await this.getClient();

    try {
      await client.send(
        new DeleteFunctionCommand({ FunctionName: functionName })
      );
    } catch (error: any) {
      console.error("Error deleting Lambda function:", error);
      throw error;
    }
  }

  @func()
  async deleteFunctionUrl(functionName: string): Promise<void> {
    const client = await this.getClient();

    try {
      await client.send(
        new DeleteFunctionUrlConfigCommand({ FunctionName: functionName })
      );
    } catch (error: any) {
      console.error("Error deleting Lambda function URL:", error);
      throw error;
    }
  }

  /**
   * Checks if a Lambda function exists
   * @param functionName The name of the Lambda function
   * @returns A Promise that resolves to a boolean indicating if the function exists
   */
  @func()
  async exists(functionName: string): Promise<boolean> {
    const client = await this.getClient();

    try {
      await client.send(new GetFunctionCommand({ FunctionName: functionName }));
      return true;
    } catch (error: any) {
      if (error.name === "ResourceNotFoundException") {
        return false;
      }
      throw error;
    }
  }

  /**
   * Checks if a function URL exists for a Lambda function
   * @param functionName The name of the Lambda function
   * @returns The URL of the function if it exists, undefined otherwise
   */
  @func()
  async functionUrlExists(functionName: string): Promise<string | undefined> {
    const client = await this.getClient();

    try {
      const resp = await client.send(
        new GetFunctionUrlConfigCommand({ FunctionName: functionName })
      );
      return resp.FunctionUrl;
    } catch (error: any) {
      if (error.name === "ResourceNotFoundException") {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Updates the code for an existing Lambda function
   * @param functionName The name of the Lambda function
   * @param zipFile The zip file containing the updated function code
   */
  @func()
  async updateCode(functionName: string, zipFile: File): Promise<void> {
    const client = await this.getClient();

    try {
      await client.send(
        new UpdateFunctionCodeCommand({
          FunctionName: functionName,
          ZipFile: await this.readZipFileBytes(zipFile),
        })
      );
    } catch (error: any) {
      console.error("Error updating Lambda function code:", error);

      throw error;
    }
  }

  /**
   * Reads the contents of a zip file and returns it as a byte array
   * @param zipFile The zip file to read
   * @returns The contents of the zip file as a byte array
   */
  private async readZipFileBytes(zipFile: File) {
    const zipPath = "/tmp/function.zip";
    await zipFile.export(zipPath);

    const zipBytes = readFileSync(zipPath);
    if (!zipBytes || zipBytes.length === 0) {
      throw new Error("Zip file is empty");
    }

    return zipBytes;
  }

  /**
   * Returns a new instance of the LambdaClient
   * @returns A Promise that resolves to a LambdaClient instance
   */
  private async getClient(): Promise<LambdaClient> {
    return new LambdaClient({
      region: this.region,
      credentials: {
        accessKeyId: await this.accessKey.plaintext(),
        secretAccessKey: await this.secretKey.plaintext(),
        ...(this.sessionToken
          ? { sessionToken: await this.sessionToken.plaintext() }
          : {}),
      },
    });
  }
}
