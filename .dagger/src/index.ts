/**
 * A module for LambdaExample functions
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

@object()
export class LambdaExample {
  source: Directory;
  baseImage: string;

  constructor(
    @argument({ defaultPath: "/" }) source: Directory,
    baseImage = "node:20"
  ) {
    this.source = source;
    this.baseImage = baseImage;
  }

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
  deploy(): Promise<string> {
    return this.base().withExec(["yarn", "deploy"]).stdout();
  }
}
