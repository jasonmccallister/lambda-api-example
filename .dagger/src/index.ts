/**
 * A module for Example functions
 */
import {
  argument,
  dag,
  Container,
  Directory,
  File,
  object,
  func,
  Secret,
} from "@dagger.io/dagger";
import {
  CreateRoleCommand,
  GetRoleCommand,
  IAMClient,
  AttachRolePolicyCommand,
  DeleteRoleCommand,
} from "@aws-sdk/client-iam";
import {
  LambdaClient,
  CreateFunctionCommand,
  GetFunctionCommand,
  UpdateFunctionCodeCommand,
  CreateFunctionUrlConfigCommand,
  GetFunctionUrlConfigCommand,
  AddPermissionCommand,
  DeleteFunctionCommand,
  DeleteFunctionUrlConfigCommand,
} from "@aws-sdk/client-lambda";
import { readFileSync } from "fs";

@object()
export class LambdaExample {
  source: Directory;
  private baseImage = "node:20";
  private functionName = "lambda-example";
  private roleName = "lambda-example-role";

  constructor(
    @argument({ defaultPath: "/" }) source: Directory,
    baseImage = "node:20",
    functionName = "lambda-example",
    roleName = "lambda-example-role"
  ) {
    this.source = source;
    this.baseImage = baseImage;
    this.functionName = functionName;
    this.roleName = roleName;
  }

  /**
   * Returns the node base image with the project setup
   */
  @func()
  base(): Container {
    return dag
      .container()
      .from(this.baseImage)
      .withExec(["apt", "update"])
      .withExec(["apt", "install", "zip"])
      .withWorkdir("/src")
      .withMountedCache("/root/.npm", dag.cacheVolume("node-20"))
      .withDirectory("/src", this.source)
      .withExec(["yarn", "install", "--frozen-lockfile"]);
  }

  /**
   * Returns the completed JavaScript build
   */
  @func()
  build(): Directory {
    return this.base().withExec(["yarn", "build"]).directory("./dist");
  }

  /**
   * Creates the Lambda deployment package
   */
  @func()
  zip(): File {
    return this.base()
      .withExec(["yarn", "build"])
      .withExec(["yarn", "zip"])
      .file("./function.zip");
  }

  /**
   * Runs the full build and deploy process
   */
  @func()
  async deploy(
    accessKey: Secret,
    secretKey: Secret,
    sessionToken?: Secret,
    region: string = "us-east-2"
  ): Promise<string> {
    const config = {
      region,
      credentials: {
        accessKeyId: await accessKey.plaintext(),
        secretAccessKey: await secretKey.plaintext(),
        ...(sessionToken
          ? { sessionToken: await sessionToken.plaintext() }
          : {}),
      },
    };

    const iamClient = new IAMClient(config);
    const lambdaClient = new LambdaClient(config);

    // does the role exist?
    if (!(await this.roleExists(iamClient, this.roleName))) {
      console.log("Creating new role " + this.roleName);

      await this.createRole(iamClient, this.roleName);
    }

    let functionUrl = "";
    // does the function exist?
    if (!(await this.functionExists(lambdaClient, this.functionName))) {
      console.log("Creating new function " + this.functionName);

      functionUrl = await this.createFunction(
        lambdaClient,
        this.functionName,
        this.roleName,
        this.zip()
      );
    } else {
      console.log("Updating existing function " + this.functionName);

      functionUrl = await this.updateFunctionCode(
        lambdaClient,
        this.functionName,
        this.zip()
      );
    }

    return Promise.resolve("Lambda deployed on url " + functionUrl);
  }

  /**
   * Destroys the Lambda function and its associated resources
   * @param accessKey Secret access key
   * @param secretKey Secret key
   * @param sessionToken Session token
   * @param region AWS region
   */
  @func()
  async destroy(
    accessKey: Secret,
    secretKey: Secret,
    sessionToken?: Secret,
    region: string = "us-east-2"
  ): Promise<string> {
    const config = {
      region,
      credentials: {
        accessKeyId: await accessKey.plaintext(),
        secretAccessKey: await secretKey.plaintext(),
        ...(sessionToken
          ? { sessionToken: await sessionToken.plaintext() }
          : {}),
      },
    };

    const iamClient = new IAMClient(config);
    const lambdaClient = new LambdaClient(config);

    // Check if the function exists
    if (await this.functionExists(lambdaClient, this.functionName)) {
      console.log("Deleting function " + this.functionName + "...");

      await lambdaClient.send(
        new DeleteFunctionCommand({ FunctionName: this.functionName })
      );
    }

    // Check if the role exists
    if (await this.roleExists(iamClient, this.roleName)) {
      console.log("Deleting role " + this.roleName + "...");

      await iamClient.send(new DeleteRoleCommand({ RoleName: this.roleName }));
    }

    // delete the function url config
    if (await this.functionUrlExists(lambdaClient, this.functionName)) {
      console.log("Deleting function URL for " + this.functionName + "...");

      await lambdaClient.send(
        new DeleteFunctionUrlConfigCommand({ FunctionName: this.functionName })
      );
    }

    return Promise.resolve(
      "Lambda function " + this.functionName + " successfully destroyed"
    );
  }

  /**
   * Creates a new IAM role using the AWS SDK if the role does not already exist
   * @param roleName The name of the role to create
   * @returns The ARN of the created role
   */
  private async createRole(
    client: IAMClient,
    roleName: string
  ): Promise<string> {
    // Check if the role already exists
    if (await this.roleExists(client, roleName)) {
      const getRoleResponse = await client.send(
        new GetRoleCommand({ RoleName: roleName })
      );
      if (getRoleResponse.Role?.Arn) {
        return getRoleResponse.Role.Arn;
      }
    }

    // Create the role if it doesn't exist
    const trustPolicy = {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: {
            Service: "lambda.amazonaws.com",
          },
          Action: "sts:AssumeRole",
        },
      ],
    };

    const createRoleResponse = await client.send(
      new CreateRoleCommand({
        RoleName: roleName,
        AssumeRolePolicyDocument: JSON.stringify(trustPolicy),
      })
    );

    if (!createRoleResponse.Role?.Arn) {
      throw new Error("Failed to create role - no ARN returned");
    }

    await client.send(
      new AttachRolePolicyCommand({
        RoleName: roleName,
        PolicyArn: "arn:aws:policy/service-role/AWSLambdaBasicExecutionRole",
      })
    );

    return createRoleResponse.Role.Arn;
  }

  /**
   * Checks if an IAM role exists
   * @param roleName The name of the role to check
   * @returns True if the role exists, false otherwise
   */
  private async roleExists(
    client: IAMClient,
    roleName: string
  ): Promise<boolean> {
    try {
      await client.send(new GetRoleCommand({ RoleName: roleName }));
      return true;
    } catch (error: any) {
      if (error.name === "NoSuchEntityException") {
        return false;
      }
      throw error;
    }
  }

  /**
   * Checks if a Lambda function exists
   * @param functionName The name of the function to check
   * @returns True if the function exists, false otherwise
   */
  private async functionExists(
    client: LambdaClient,
    functionName: string
  ): Promise<boolean> {
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
   * Updates the code of an existing Lambda function
   * @param functionName The name of the function to update
   * @param zipFile The zip file containing the new code
   * @returns The function ARN
   */
  private async updateFunctionCode(
    client: LambdaClient,
    functionName: string,
    zipFile: File
  ): Promise<string> {
    const zipBytes = await this.readZipFileBytes(zipFile);

    try {
      await client.send(
        new UpdateFunctionCodeCommand({
          FunctionName: functionName,
          ZipFile: zipBytes,
        })
      );
    } catch (error) {
      console.error("Error updating function code:", error);
      throw error;
    }

    // Get the updated function ARN
    const getFunctionResponse = await client.send(
      new GetFunctionCommand({ FunctionName: functionName })
    );

    if (!getFunctionResponse.Configuration?.FunctionArn) {
      throw new Error("Failed to get function ARN after update");
    }

    //todo make this call get function url
    return await this.createFunctionUrl(client, functionName);
  }

  /**
   * Creates a new Lambda function using the AWS SDK
   * @param functionName The name of the function to create
   * @param roleName The name of the IAM role for the function
   * @returns The ARN of the created or existing function
   */
  private async createFunction(
    client: LambdaClient,
    functionName: string,
    roleName: string,
    zipFile: File
  ): Promise<string> {
    // Export the zip file to get it as proper binary data
    const zipBytes = await this.readZipFileBytes(zipFile);

    const response = await client.send(
      new CreateFunctionCommand({
        FunctionName: functionName,
        Runtime: "nodejs20.x",
        Role: roleName,
        Handler: "index.handler",
        Architectures: ["arm64"],
        Code: {
          ZipFile: zipBytes,
        },
        Timeout: 10,
        MemorySize: 256,
        Environment: {
          Variables: {},
        },
        Description: "Simple Tailwind HTML + JSON API via Lambda Function URL",
      })
    );

    if (!response.FunctionArn) {
      throw new Error("Failed to create function - no ARN returned");
    }

    // Create function URL for the new function
    return await this.createFunctionUrl(client, functionName);
  }

  /**
   * Reads the contents of a zip file and returns it as a byte array
   * @param zipFile The zip file to read
   * @returns The contents of the zip file as a byte array
   */
  private async readZipFileBytes(zipFile: File) {
    const zipPath = "/tmp/create_function.zip";
    await zipFile.export(zipPath);
    const zipBytes = readFileSync(zipPath);
    if (!zipBytes || zipBytes.length === 0) {
      throw new Error("Zip file is empty");
    }
    return zipBytes;
  }

  /**
   * Creates a function URL configuration for a Lambda function if it doesn't already exist
   * @param functionName The name of the function to create URL config for
   * @returns The function URL
   */
  private async createFunctionUrl(
    client: LambdaClient,
    functionName: string
  ): Promise<string> {
    try {
      // Check if function URL already exists
      const getFunctionUrlResponse = await client.send(
        new GetFunctionUrlConfigCommand({ FunctionName: functionName })
      );
      if (getFunctionUrlResponse.FunctionUrl) {
        return getFunctionUrlResponse.FunctionUrl;
      }
    } catch (error: any) {
      // Function URL doesn't exist if we get ResourceNotFound error
      if (error.name !== "ResourceNotFoundException") {
        throw error;
      }
    }

    // Create function URL if it doesn't exist
    const createUrlResponse = await client.send(
      new CreateFunctionUrlConfigCommand({
        FunctionName: functionName,
        AuthType: "NONE",
        Cors: {
          AllowOrigins: ["*"],
          AllowMethods: ["*"],
          AllowHeaders: ["*"],
          AllowCredentials: false,
        },
      })
    );

    if (!createUrlResponse.FunctionUrl) {
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
          FunctionUrlAuthType: "NONE",
        })
      );
    } catch (error: any) {
      // Ignore if permission already exists
      if (error.name !== "ResourceConflictException") {
        throw error;
      }
    }

    return createUrlResponse.FunctionUrl;
  }

  /**
   * Checks if a Lambda function URL exists
   * @param client The LambdaClient instance
   * @param functionName The name of the function
   * @returns True if the function URL exists, false otherwise
   */
  private async functionUrlExists(
    client: LambdaClient,
    functionName: string
  ): Promise<boolean> {
    try {
      await client.send(
        new GetFunctionUrlConfigCommand({ FunctionName: functionName })
      );
      return true;
    } catch (error: any) {
      if (error.name === "ResourceNotFoundException") {
        return false;
      }
      throw error;
    }
  }
}
