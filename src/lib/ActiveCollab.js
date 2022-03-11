const _ = require("lodash");
const axios = require("axios").default;

class ActiveCollabProject {
  #api;

  id;
  name;

  constructor(project, api) {
    this.#api = api;

    this.id = project.id;
    this.name = project.name;
  }

  time(filter) {
    return this.#api
      .get(`/api/v1/projects/${this.id}/time-records/filtered-by-date`, {
        params: filter,
      })
      .then(({ data }) => data.time_records);
  }
}

class ActiveCollab {
  #api;

  constructor(props) {
    this.#api = axios.create({
      baseURL: `https://app.activecollab.com/${props.accountId}`,
      headers: {
        "Content-Type": "application/json",
        "X-Angie-AuthApiToken": props.token,
      },
    });

    return this;
  }

  static login(input) {
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

  static issueToken(input) {
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

module.exports = ActiveCollab;
