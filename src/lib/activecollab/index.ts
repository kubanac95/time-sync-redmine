import _ from "lodash";
import axios, { Axios } from "axios";
import { Config, Project } from "./types";

class ActiveCollabProject {
  #api;

  id;
  name;

  constructor(project: Project, api: Axios) {
    this.#api = api;

    this.id = project.id;
    this.name = project.name;
  }

  time(filter?: { from?: string; to?: string }) {
    return this.#api
      .get(`/api/v1/projects/${this.id}/time-records/filtered-by-date`, {
        params: filter,
      })
      .then(({ data }) => data.time_records);
  }
}

class ActiveCollabAPI {
  #api;

  constructor(props: Config) {
    this.#api = axios.create({
      baseURL: `https://app.activecollab.com/${props.accountId}`,
      headers: {
        "Content-Type": "application/json",
        "X-Angie-AuthApiToken": props.token,
      },
    });

    return this;
  }

  static login(input: { email: string; password: string }) {
    return axios
      .post("https://my.activecollab.com/api/v1/external/login", input)
      .then(({ data }) => {
        if (!(data.user && data.user.intent)) {
          throw new Error("Failed to acquire access token");
        }

        if (!(Array.isArray(data.accounts) && data.accounts.length > 0)) {
          throw new Error("Your are not linked to any account");
        }

        return data;
      });
  }

  static issueToken(input: {
    intent: string;
    client_name: string;
    client_vendor: string;
  }) {
    return axios
      .post(
        `https://app.activecollab.com/${input.client_name}/api/v1/issue-token`,
        input
      )
      .then(({ data }) => {
        if (!(data.is_ok && data.token)) {
          throw new Error("Invalid credentials");
        }

        return data;
      });
  }

  projects() {
    return this.#api
      .get("/api/v1/projects")
      .then(({ data }) =>
        _.map(data, (project) => new ActiveCollabProject(project, this.#api))
      );
  }
}

export * from "./types";

export default ActiveCollabAPI;
