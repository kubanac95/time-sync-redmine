export interface Config {
  subdomain: string;
  username: string;
  password: string;
}

interface AvatarURLS {
  "48x48": string;
  "24x24": string;
  "16x16": string;
  "32x32": string;
}

export interface User {
  self: string;
  accountId: string;
  emailAddress: string;
  avatarUrls: AvatarURLS;
  displayName: string;
  active: boolean;
  timeZone: string;
  locale: string;
  groups: {
    size: 1;
    items: [];
  };
  applicationRoles: {
    size: 1;
    items: [];
  };
  expand: string;
}

export interface Project {
  expand: string;
  self: string;
  id: string;
  key: string;
  name: string;
  avatarUrls: AvatarURLS;
  projectTypeKey: "software";
  simplified: boolean;
  style: "classic";
  isPrivate: boolean;
  properties: Record<string, unknown>;
}

export interface IssueFilter {
  jql?: string;
}

export interface Issue {
  id: string;
  key: string;
  self: string;
  expand: string;
  fields: any;
}

export type PaginatedResponse<Data extends Record<string, unknown>> = Data & {
  expand: string;
  startAt: number;
  maxResults: number;
  total: number;
};
