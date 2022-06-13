import axios from "axios";

import {
  Config,
  User,
  Project,
  IssueFilter,
  Issue,
  PaginatedResponse,
} from "./types";

class JiraAPI {
  #api;

  constructor(props: Config) {
    this.#api = axios.create({
      baseURL: `https://${props.subdomain}.atlassian.net/rest/api`,
      auth: {
        username: props.username,
        password: props.password,
      },
    });

    return this;
  }

  user(): Promise<User> {
    return this.#api.get<User>("/2/myself").then(({ data }) => data);
  }

  projects(): Promise<Project[]> {
    return this.#api.get<Project[]>("/2/project").then(({ data }) => data);
  }

  issues(body: IssueFilter) {
    return this.#api
      .post<PaginatedResponse<{ issues: Issue[] }>>("/3/search", body)
      .then(({ data }) => data);
  }
}

export * from "./types";

export default JiraAPI;
