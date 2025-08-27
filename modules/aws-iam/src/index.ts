import {
  AttachRolePolicyCommand,
  CreateRoleCommand,
  DeleteRoleCommand,
  GetRoleCommand,
  IAMClient,
} from "@aws-sdk/client-iam";
import { object, func, Secret } from "@dagger.io/dagger";

@object()
export class AwsIam {
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
   * Creates a new IAM role
   * @param roleName The name of the role to create
   * @returns The ARN of the created role
   */
  @func()
  async create(roleName: string): Promise<string> {
    const client = await this.getClient();

    let roleArn: string | undefined;
    try {
      const create = await client.send(
        new CreateRoleCommand({
          RoleName: roleName,
          AssumeRolePolicyDocument: JSON.stringify({
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
          }),
        })
      );

      if (!create.Role || !create.Role.Arn) {
        throw new Error("Failed to create role");
      }

      roleArn = create.Role.Arn;
    } catch (error) {
      console.error("Error creating role:", error);
      throw error;
    }

    try {
      await client.send(
        new AttachRolePolicyCommand({
          RoleName: roleName,
          PolicyArn: "arn:aws:policy/service-role/AWSLambdaBasicExecutionRole",
        })
      );
    } catch (error) {
      console.error("Error attaching role policy:", error);
      throw error;
    }

    let attempts = 0;
    const maxAttempts = 5;
    while (attempts < maxAttempts) {
      let roleArn = await this.exists(roleName);
      if (roleArn) {
        console.log(`Role ${roleName} is ready`);
        break; // Role exists, exit loop
      }

      // sleep for 2 seconds
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    return roleArn;
  }

  /**
   * Checks if an IAM role exists
   * @param roleName The name of the role to check
   * @returns The ARN of the role if it exists, undefined otherwise
   */
  @func()
  async exists(roleName: string): Promise<string | undefined> {
    const client = await this.getClient();
    try {
      const get = await client.send(new GetRoleCommand({ RoleName: roleName }));

      return get.Role?.Arn || undefined;
    } catch (error: any) {
      if (error.name === "NoSuchEntityException") {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Creates a new IAM client
   * @returns The IAM client
   */
  private async getClient(): Promise<IAMClient> {
    return new IAMClient({
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

  /**
   * Removes an IAM role
   * @param roleName The name of the role to remove
   */
  @func()
  async remove(roleName: string): Promise<void> {
    const client = await this.getClient();
    try {
      await client.send(new DeleteRoleCommand({ RoleName: roleName }));
    } catch (error) {
      console.error("Error deleting role:", error);
      throw error;
    }
  }
}
