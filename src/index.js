const fs = require("fs-extra");

const axios = require("axios").default;
const dotenv = require("dotenv");
const chalk = require("chalk");
const _ = require("lodash");

const fuzzy = require("fuzzy");

const inquirer = require("inquirer");
inquirer.registerPrompt("date", require("inquirer-date-prompt"));
inquirer.registerPrompt(
  "autocomplete",
  require("inquirer-autocomplete-prompt")
);

const dayjs = require("dayjs");

dayjs.extend(require("dayjs/plugin/utc"));
dayjs.extend(require("dayjs/plugin/timezone"));
dayjs.extend(require("dayjs/plugin/duration"));
dayjs.extend(require("dayjs/plugin/relativeTime"));

const locale = require("dayjs/locale/en");

dayjs.locale({
  ...locale,
  weekStart: 1,
});

const Jira = require("./lib/jira").default;
const ActiveCollab = require("./lib/activecollab").default;

if (!fs.existsSync(".env")) {
  fs.writeFileSync(".env", "");
}

let config = {
  ACTIVE_COLLAB_USERNAME: "",
  ACTIVE_COLLAB_PASSWORD: "",
  ACTIVE_COLLAB_TOKEN: "",
  ACTIVE_COLLAB_ACCOUNT: "",
  REDMINE_BASE_URL: "",
  REDMINE_API_KEY: "",
  JIRA_SUBDOMAIN: "",
  JIRA_USERNAME: "",
  JIRA_PASSWORD: "",
  ...dotenv.parse(
    fs.readFileSync(".env", {
      encoding: "utf8",
    })
  ),
};

function updateEnv(config = {}, eol = "\n") {
  const envContents = Object.entries({ ...config, ...config })
    .map(([key, val]) => `${key}=${val}`)
    .join(eol);

  fs.writeFileSync(".env", envContents);
}

const validateMandatoryString = (message) => (v) =>
  (typeof v === "string" && v.length > 0) || message;

/**
 * https://developers.activecollab.com/api-documentation/index.html
 */

async function authenticateActiveCollab() {
  /**
   * Skip authenticating with ActiveCollab if we have all the credentials
   */
  if (config.ACTIVE_COLLAB_TOKEN && config.ACTIVE_COLLAB_ACCOUNT) {
    return new ActiveCollab({
      token: config.ACTIVE_COLLAB_TOKEN,
      accountId: config.ACTIVE_COLLAB_ACCOUNT,
    });
  }

  const credentials = await inquirer.prompt([
    {
      message: "ActiveCollab email",
      name: "ACTIVE_COLLAB_USERNAME",
      type: "input",
      default: config.ACTIVE_COLLAB_USERNAME || "",
      validate: validateMandatoryString("ActiveCollab email is required"),
      when: !config.ACTIVE_COLLAB_USERNAME,
    },
    {
      message: "ActiveCollab password [masked]",
      name: "ACTIVE_COLLAB_PASSWORD",
      type: "password",
      default: config.ACTIVE_COLLAB_PASSWORD || "",
      validate: validateMandatoryString("ActiveCollab password is required"),
      when: !config.ACTIVE_COLLAB_PASSWORD,
    },
  ]);

  console.log(chalk.gray(`Authentication with ActiveCollab`));

  config = {
    ...config,
    ...credentials,
  };

  const loginResponse = await ActiveCollab.login({
    email: config.ACTIVE_COLLAB_USERNAME,
    password: config.ACTIVE_COLLAB_PASSWORD,
  });

  console.log(chalk.green(`Authentication with ActiveCollab successful`));

  if (!(loginResponse.is_ok && Array.isArray(loginResponse.accounts))) {
    throw new Error("Not ok");
  }

  const { user, accounts } = loginResponse;

  const { accountName = accounts[0].name } = await inquirer.prompt([
    {
      name: "accountName",
      type: "list",
      message: "Chose account",
      choices: accounts,
      when: accounts.length > 1,
      default: accounts[0],
    },
  ]);

  const account = accounts.find((item) => item.name === accountName);

  const tokenResponse = await ActiveCollab.issueToken({
    intent: user.intent,
    client_name: `${account.name}`,
    client_vendor: account.display_name,
  });

  if (!tokenResponse.token) {
    throw new Error("Unable to authenticate");
  }

  console.log(chalk.gray(`Issuing ActiveCollab token successfully`));

  config = {
    ...config,
    ACTIVE_COLLAB_TOKEN: tokenResponse.token,
    ACTIVE_COLLAB_ACCOUNT: account.name,
  };

  const { remember } = await inquirer.prompt({
    message: "Remember credentials?",
    name: "remember",
    type: "confirm",
  });

  if (remember) {
    updateEnv(config);
  }

  return new ActiveCollab({
    token: config.ACTIVE_COLLAB_TOKEN,
    accountId: config.ACTIVE_COLLAB_ACCOUNT,
  });
}

async function selectProject(instance) {
  const projects = await instance.projects();

  const { projectName } = await inquirer.prompt({
    name: "projectName",
    type: "autocomplete",
    message: "Chose project",
    source: (_answersSoFar, input = "") =>
      new Promise((resolve) =>
        resolve(
          fuzzy
            .filter(input, projects, { extract: (item) => item.name })
            .map((item) => item.original)
        )
      ),
  });

  const project = projects.find((item) => item.name === projectName);

  return project;
}

async function selectProjectTime(instance) {
  const project = await selectProject(instance);

  const timeRecordsFilter = await inquirer.prompt([
    {
      message: "From",
      name: "from",
      type: "date",
      format: {
        hour: undefined,
        minute: undefined,
      },
      default: dayjs().startOf("week").toDate(),
    },
    {
      message: "To",
      name: "to",
      type: "date",
      format: {
        hour: undefined,
        minute: undefined,
      },
      default: dayjs().endOf("week").toDate(),
    },
  ]);

  const timeRecords = await project.time({
    from: dayjs(timeRecordsFilter.from).format("YYYY-MM-DD"),
    to: dayjs(timeRecordsFilter.t).format("YYYY-MM-DD"),
  });

  const totalRecords = timeRecords.length;
  const totalHours = _.sumBy(timeRecords, "value");

  console.log(
    chalk.gray(
      `Found ${totalRecords} records with a total of ${dayjs
        .duration(totalHours, "hours")
        .format("HH:mm")} hours`
    )
  );

  return timeRecords;
}

/**
 * https://www.redmine.org/projects/redmine/wiki/rest_api
 */
async function authenticateRedmine() {
  const credentials = await inquirer.prompt([
    {
      message: "Redmine URL",
      name: "REDMINE_BASE_URL",
      type: "input",
      default: config.REDMINE_BASE_URL || "",
      validate: validateMandatoryString("Redmine URL is required"),
      when: !config.REDMINE_BASE_URL,
    },
    {
      message: "Redmine API Key",
      name: "REDMINE_API_KEY",
      type: "input",
      default: config.REDMINE_API_KEY,
      validate: validateMandatoryString("Redmine API Key is required"),
      when: !config.REDMINE_API_KEY,
    },
  ]);

  config = {
    ...config,
    ...credentials,
  };

  const RedmineAPI = axios.create({
    baseURL: config.REDMINE_BASE_URL,
    headers: {
      "Content-Type": "application/json",
      "X-Redmine-API-Key": config.REDMINE_API_KEY,
    },
  });

  const projects = await RedmineAPI.get("/projects.json").then(
    ({ data }) => data
  );

  if (projects) {
    const { remember } = await inquirer.prompt({
      message: "Remember Redmine credentials?",
      name: "remember",
      type: "confirm",
    });

    if (remember) {
      updateEnv(credentials);
    }
  }

  return RedmineAPI;
}

async function authenticateJira() {
  const remembered =
    !!config.JIRA_SUBDOMAIN && !!config.JIRA_PASSWORD && !!config.JIRA_USERNAME;

  const credentials = await inquirer.prompt([
    {
      message: "Subdomain",
      name: "JIRA_SUBDOMAIN",
      type: "input",
      default: config.JIRA_SUBDOMAIN || "",
      validate: validateMandatoryString("Subdomain is required"),
      when: !config.JIRA_SUBDOMAIN,
    },
    {
      message: "Email",
      name: "JIRA_USERNAME",
      type: "input",
      default: config.JIRA_USERNAME || "",
      validate: validateMandatoryString("Email is required"),
      when: !config.JIRA_USERNAME,
    },
    {
      message: "Password [masked]",
      name: "JIRA_PASSWORD",
      type: "password",
      default: config.JIRA_PASSWORD || "",
      validate: validateMandatoryString("Password is required"),
      when: !config.JIRA_PASSWORD,
    },
  ]);

  config = {
    ...config,
    ...credentials,
  };

  const API = new Jira({
    subdomain: config.JIRA_SUBDOMAIN,
    username: config.JIRA_USERNAME,
    password: config.JIRA_PASSWORD,
  });

  const user = await API.user();

  if (user && !remembered) {
    const { remember } = await inquirer.prompt({
      message: "Remember credentials?",
      name: "remember",
      type: "confirm",
    });

    if (remember) {
      updateEnv(credentials);
    }
  }

  return API;
}

(async () => {
  const response = await inquirer.prompt({
    name: "command",
    type: "list",
    message: "Which action would you like to take?",
    choices: [
      { name: "Export", value: "export" },
      { name: "Import", value: "import" },
    ],
  });

  switch (response.command) {
    case "export": {
      const response = await inquirer.prompt({
        name: "service",
        type: "list",
        message: "From?",
        choices: [
          { name: "ActiveCollab", value: "activecollab" },
          { name: "Redmine", value: "redmine" },
          { name: "Jira", value: "jira" },
        ],
      });

      switch (response.service) {
        case "jira": {
          const JiraAPI = await authenticateJira();

          const projects = await JiraAPI.projects();

          const { projectName } = await inquirer.prompt({
            name: "projectName",
            type: "autocomplete",
            message: "Chose project",
            source: (_answersSoFar, input = "") =>
              new Promise((resolve) =>
                resolve(
                  fuzzy
                    .filter(input, projects, { extract: (item) => item.name })
                    .map((item) => item.original)
                )
              ),
          });

          const project = projects.find((item) => item.name === projectName);

          console.log(project);

          const issues = await JiraAPI.issues({
            jql: `project = "${project.key}" AND created >= "2022-05-29" AND created <= "2022-06-03" AND assignee = currentUser() ORDER BY created DESC`,
          });

          console.log(project, issues);

          break;
        }

        case "activecollab": {
          const ActiveCollabAPI = await authenticateActiveCollab();

          const time = await selectProjectTime(ActiveCollabAPI);

          const response = await inquirer.prompt({
            name: "command",
            type: "list",
            message: "From?",
            choices: [
              { name: "Save to JSON", value: "file-json" },
              // { name: "Save to CSV", value: "file-csv" },
              { name: "Import", value: "import" },
            ],
          });

          switch (response.command) {
            case "file-json": {
              return fs.writeJSONSync("export.json", time, { spaces: "\t" });
            }

            case "import": {
              return;
            }

            default: {
              return;
            }
          }
        }

        case "redmine": {
          const RedmineAPI = await authenticateRedmine();

          const time = await RedmineAPI.get("/time_entries.json", {
            params: {},
          }).then((response) => response.data.time_entries);

          const res = await inquirer.prompt({
            name: "command",
            type: "list",
            message: "From?",
            choices: [
              { name: "Save to JSON", value: "file-json" },
              // { name: "Save to CSV", value: "file-csv" },
              { name: "Import", value: "import" },
            ],
          });

          switch (res.command) {
            case "file-json": {
              console.log(time);
              return fs.writeJSONSync("export.json", time, { spaces: "\t" });
            }

            default: {
              return;
            }
          }
        }
      }

      return;
    }

    case "import": {
      return;
    }

    default: {
      return;
    }
  }
})().catch((error) => {
  if (error.response) {
    // console.log(error.response);
  }
  console.log(chalk.redBright(error.message));

  return process.exit(1);
});
