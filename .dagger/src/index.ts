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
} from "@dagger.io/dagger";
import {
  CreateRoleCommand,
  GetRoleCommand,
  IAMClient,
  AttachRolePolicyCommand,
} from "@aws-sdk/client-iam";
import {
  LambdaClient,
  CreateFunctionCommand,
  GetFunctionCommand,
  UpdateFunctionCodeCommand,
  CreateFunctionUrlConfigCommand,
  GetFunctionUrlConfigCommand,
  AddPermissionCommand,
} from "@aws-sdk/client-lambda";

@object()
export class LambdaExample {
  constructor(
    @argument({ defaultPath: "/" }) private source: Directory,
    private baseImage = "node:20",
    private functionName = "lambda-example",
    private roleName = "lambda-example-role"
  ) {}

  /**
   * Returns the node base image with the project setup
   */
  @func()
  base(): Container {
    return dag
      .container()
      .from(this.baseImage)
      .withWorkdir("/src")
      .withDirectory("/src", this.source)
      .withExec(["yarn", "install"]);
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
  async deploy(): Promise<string> {
    // make sure there is a role with the name
    const zip = this.zip();
    const role = await this.createRole(this.roleName);
    const fn = await this.createFunction(this.functionName, role, zip);
    const url = await this.createFunctionUrl(fn);

    // make sure the function exists
    return this.base().withExec(["yarn", "deploy"]).stdout();
  }

  /**
   * Creates a new IAM role using the AWS SDK if the role does not already exist
   * @param roleName The name of the role to create
   * @returns The ARN of the created role
   */
  @func()
  async createRole(roleName: string): Promise<string> {
    const client = new IAMClient({});

    try {
      // Check if the role already exists
      const getRoleResponse = await client.send(
        new GetRoleCommand({ RoleName: roleName })
      );
      if (getRoleResponse.Role?.Arn) {
        return getRoleResponse.Role.Arn;
      }
    } catch (error: any) {
      // Role doesn't exist if we get NoSuchEntity error
      if (error.name !== "NoSuchEntityException") {
        throw error;
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
   * Creates a new Lambda function using the AWS SDK if the function does not already exist
   * @param functionName The name of the function to create
   * @param roleName The name of the IAM role for the function
   * @returns The ARN of the created or existing function
   */
  @func()
  async createFunction(
    functionName: string,
    roleName: string,
    zipFile: File
  ): Promise<string> {
    const client = new LambdaClient({});

    try {
      // Check if the function already exists
      const getFunctionResponse = await client.send(
        new GetFunctionCommand({ FunctionName: functionName })
      );
      if (getFunctionResponse.Configuration?.FunctionArn) {
        const zipBytes = new TextEncoder().encode(await zipFile.contents());

        await client.send(
          new UpdateFunctionCodeCommand({
            FunctionName: functionName,
            ZipFile: zipBytes,
          })
        );

        // Ensure function URL is created for existing function
        await this.createFunctionUrl(functionName);

        return getFunctionResponse.Configuration.FunctionArn;
      }
    } catch (error: any) {
      // Function doesn't exist if we get ResourceNotFound error
      if (error.name !== "ResourceNotFoundException") {
        throw error;
      }
    }

    // Create the function if it doesn't exist
    const zipBytes = new TextEncoder().encode(await zipFile.contents());

    const createFunctionResponse = await client.send(
      new CreateFunctionCommand({
        FunctionName: functionName,
        Runtime: "nodejs20.x",
        Role: await this.createRole(roleName),
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

    if (!createFunctionResponse.FunctionArn) {
      throw new Error("Failed to create function - no ARN returned");
    }

    // Create function URL for the new function
    await this.createFunctionUrl(functionName);

    return createFunctionResponse.FunctionArn;
  }

  /**
   * Creates a function URL configuration for a Lambda function if it doesn't already exist
   * @param functionName The name of the function to create URL config for
   * @returns The function URL
   */
  @func()
  async createFunctionUrl(functionName: string): Promise<string> {
    const client = new LambdaClient({});

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
}
