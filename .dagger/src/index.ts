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

    const iam = dag.awsIam(accessKey, secretKey, region, {
      sessionToken,
    });
    const lambda = dag.awsLambda(accessKey, secretKey, region, {
      sessionToken,
    });

    let roleArn = await iam.exists(this.roleName);
    // does the role exist?
    if (!roleArn) {
      console.log("Creating new role " + this.roleName);

      roleArn = await iam.create(this.roleName);
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

    const iam = dag.awsIam(accessKey, secretKey, region, {
      sessionToken,
    });
    const lambda = dag.awsLambda(accessKey, secretKey, region, {
      sessionToken,
    });

    // Check if the function exists
    if (await lambda.exists(this.functionName)) {
      console.log("Removing function " + this.functionName + "...");

      await lambda.remove(this.functionName);
    }

    // Check if the role exists
    if (await iam.exists(this.roleName)) {
      console.log("Removing role " + this.roleName + "...");

      await iam.remove(this.roleName);
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
}
