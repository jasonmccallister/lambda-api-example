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

@object()
export class LambdaApiExample {
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
   * Runs the tests
   * @returns The test output
   */
  @func()
  async test(): Promise<string> {
    return this.base().withExec(["yarn", "test"]).stdout();
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
    // run the tests
    await this.test();

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

    const lambda = dag.awsLambda(accessKey, secretKey, region, {
      sessionToken,
    });

    let roleArn = await this.roleExists(iamClient, this.roleName);
    // does the role exist?
    if (!roleArn) {
      console.log("Creating new role " + this.roleName);

      roleArn = await this.createRole(iamClient, this.roleName);
    }

    if (!(await lambda.exists(this.functionName))) {
      console.log("Creating new function " + this.functionName);

      await lambda.create(
        this.functionName,
        roleArn,
        "index.handler",
        "nodejs20.x",
        this.zip()
      );
    } else {
      console.log("Updating existing function " + this.functionName);

      await lambda.updateCode(this.functionName, this.zip());
    }

    // create the function URL
    let functionUrl = "";
    try {
      functionUrl = await lambda.createFunctionUrl(this.functionName);
    } catch (error) {
      console.error("Error creating function URL:", error);
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
    const lambda = dag.awsLambda(accessKey, secretKey, region, {
      sessionToken,
    });

    // Check if the function exists
    if (await lambda.exists(this.functionName)) {
      console.log("Deleting function " + this.functionName + "...");

      await lambda.delete_(this.functionName);
    }

    // Check if the role exists
    if (await this.roleExists(iamClient, this.roleName)) {
      console.log("Deleting role " + this.roleName + "...");

      await iamClient.send(new DeleteRoleCommand({ RoleName: this.roleName }));
    }

    // delete the function url config
    if (await lambda.functionUrlExists(this.functionName)) {
      console.log("Deleting function URL for " + this.functionName + "...");

      await lambda.deleteFunctionUrl(this.functionName);
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

    // Wait for the role to be available (up to 5 attempts)
    let attempts = 0;
    const maxAttempts = 5;
    while (attempts < maxAttempts) {
      let roleArn = await this.roleExists(client, roleName);
      if (roleArn) {
        console.log(`Role ${roleName} is ready`);
        break; // Role exists, exit loop
      }

      // sleep for 2 seconds
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

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
  ): Promise<string | undefined> {
    try {
      const getRoleResponse = await client.send(
        new GetRoleCommand({ RoleName: roleName })
      );

      return getRoleResponse.Role?.Arn || undefined;
    } catch (error: any) {
      if (error.name === "NoSuchEntityException") {
        return undefined;
      }
      throw error;
    }
  }
}
