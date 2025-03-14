export class RepoBuilder {
  constructor(folderPath: string, microServiceName: string, config: any);
  buildGraph(): Promise<void>;
}
