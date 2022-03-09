const fs = require("fs");

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

if (!fs.existsSync(".env")) {
  fs.writeFileSync(".env", "");
}

const currentConfig = dotenv.parse(
  fs.readFileSync(".env", {
    encoding: "utf8",
  })
);

function updateEnv(config = {}, eol = "\n") {
  const envContents = Object.entries({ ...currentConfig, ...config })
    .map(([key, val]) => `${key}=${val}`)
    .join(eol);

  fs.writeFileSync(".env", envContents);
}

const validateMandatoryString = (message) => (v) =>
  (typeof v === "string" && v.length > 0) || message;

function login(input) {
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

function issueToken(input) {
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

async function issueAccountToken(user, account) {
  console.log(chalk.gray(`Issuing ActiveCollab token`));

  const tokenResponse = await issueToken({
    intent: user.intent,
    client_name: `${account.name}`,
    client_vendor: account.display_name,
  });

  if (!tokenResponse.token) {
    throw new Error("Unable to authenticate");
  }

  console.log(chalk.gray(`Issuing ActiveCollab token successfully`));

  return tokenResponse.token;
}

async function authenticateActiveCollab() {
  const { email } = await inquirer.prompt({
    message: "ActiveCollab email",
    name: "email",
    type: "input",
    default: currentConfig.ACTIVE_COLLAB_USERNAME || "",
    validate: validateMandatoryString("ActiveCollab email is required"),
  });

  const { password } = await inquirer.prompt({
    message: "ActiveCollab password",
    name: "password",
    type: "password",
    default: currentConfig.ACTIVE_COLLAB_PASSWORD || "",
    validate: validateMandatoryString("ActiveCollab password is required"),
  });

  console.log(chalk.gray(`Authentication with ActiveCollab`));

  const loginResponse = await login({ email, password });

  console.log(chalk.green(`Authentication with ActiveCollab successful`));

  if (loginResponse.is_ok !== true) {
    throw new Error("Not ok");
  }

  const { user, accounts } = loginResponse;

  if (accounts.length === 1) {
    console.log(chalk.gray(`Found only one account. Selecting it as default`));

    const account = accounts[0];

    const token = await issueAccountToken(user, account);

    return {
      token,
      user,
      account,
    };
  }

  const { accountId } = await inquirer.prompt([
    {
      name: "accountId",
      type: "list",
      message: "Chose account",
      choices: accounts.map((item) => item.name),
    },
  ]);

  const account = accounts.find((item) => item.name === accountId);

  const token = await issueAccountToken(user, account);

  return {
    token,
    user,
    account,
  };
}

(async () => {
  let session = {
    ACTIVE_COLLAB_TOKEN: undefined,
    ACTIVE_COLLAB_BASE_URL: undefined,
    ...currentConfig,
  };

  if (!(session.ACTIVE_COLLAB_TOKEN && session.ACTIVE_COLLAB_BASE_URL)) {
    const authenticateResponse = await authenticateActiveCollab();

    session = {
      ...session,
      ACTIVE_COLLAB_TOKEN: `${authenticateResponse.token}`,
      ACTIVE_COLLAB_BASE_URL: `https://app.activecollab.com/${authenticateResponse.account.name}`,
    };

    const { remember } = await inquirer.prompt({
      message: "Remember ActiveCollab token?",
      name: "remember",
      type: "confirm",
    });

    if (remember) {
      updateEnv(session);
    }
  }

  const instance = axios.create({
    baseURL: session.ACTIVE_COLLAB_BASE_URL,
    headers: {
      "Content-Type": "application/json",
      "X-Angie-AuthApiToken": session.ACTIVE_COLLAB_TOKEN,
    },
  });

  console.log(chalk.gray(`Fetching projects`));

  const projects = await instance
    .get("/api/v1/projects")
    .then(({ data }) => data);

  const { projectName } = await inquirer.prompt({
    name: "projectName",
    type: "autocomplete",
    message: "Chose project",
    source: (answersSoFar, input = "") =>
      new Promise((resolve) =>
        resolve(
          fuzzy
            .filter(input, projects, { extract: (item) => item.name })
            .map((item) => item.original)
        )
      ),
  });

  const project = projects.find((item) => item.name === projectName);

  console.log(chalk.gray(`Time record filter: `));

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

  const timeRecords = await instance
    .get(`/api/v1/projects/${project.id}/time-records/filtered-by-date`, {
      params: {
        from: dayjs(timeRecordsFilter.from).format("YYYY-MM-DD"),
        to: dayjs(timeRecordsFilter.t).format("YYYY-MM-DD"),
      },
    })
    .then(({ data }) => data.time_records);

  const totalRecords = timeRecords.length;
  const totalHours = _.sumBy(timeRecords, "value");

  console.log(
    chalk.gray(
      `Found ${totalRecords} records with a total of ${dayjs
        .duration(totalHours, "hours")
        .format("HH:mm")} hours`
    )
  );

  // const { redmineApiKey } = await inquirer.prompt([
  //   {
  //     message: "Enter Redmine API key?",
  //     name: "redmineApiKey",
  //     type: "input",
  //     default: "205c49de68da189f08fca73b14a2b620f221dd44",
  //   },
  // ]);
})().catch((error) => {
  if (error.response) {
    // console.log(error.response);
  }
  console.log(chalk.redBright(error.message));

  return process.exit(1);
});
