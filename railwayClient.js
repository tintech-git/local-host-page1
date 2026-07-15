"use strict";

/**
 * Thin wrapper around Railway's public GraphQL API.
 *
 * Docs: https://docs.railway.com/reference/public-api
 * Endpoint: https://backboard.railway.app/graphql/v2
 *
 * IMPORTANT: Railway's API is not versioned and field names have
 * changed before. If a call here starts failing, the error message
 * from Railway is passed straight through to the panel UI - check it
 * against the current docs / GraphiQL playground linked above.
 */

const RAILWAY_API = "https://backboard.railway.app/graphql/v2";

class RailwayError extends Error {
  constructor(message, graphQLErrors) {
    super(message);
    this.name = "RailwayError";
    this.graphQLErrors = graphQLErrors;
  }
}

async function gql(token, query, variables) {
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  let json;
  try {
    json = await res.json();
  } catch {
    throw new RailwayError(`Railway API returned a non-JSON response (HTTP ${res.status})`);
  }

  if (!res.ok || json.errors) {
    const msg = json.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw new RailwayError(msg, json.errors);
  }

  return json.data;
}

/** Verifies the token works and returns basic account info. */
async function verifyToken(token) {
  const data = await gql(
    token,
    `query { me { id name email } }`
  );
  return data.me;
}

/**
 * Returns the workspaces this token can see. Railway now requires a
 * workspaceId when creating a project (accounts are organized into
 * workspaces even for solo use), so we look this up right after the
 * token is verified rather than assuming a "personal account" exists.
 */
async function getWorkspaces(token) {
  const data = await gql(
    token,
    `query { me { workspaces { id name } } }`
  );
  return data.me?.workspaces || [];
}

/** Creates a fresh Railway project and returns its id + default environment id. */
async function createProject(token, name, workspaceId) {
  const input = { name };
  if (workspaceId) input.workspaceId = workspaceId;

  const data = await gql(
    token,
    `mutation ProjectCreate($input: ProjectCreateInput!) {
      projectCreate(input: $input) {
        id
        environments {
          edges { node { id name } }
        }
      }
    }`,
    { input }
  );

  const project = data.projectCreate;
  const env = project.environments.edges[0]?.node;
  if (!env) throw new RailwayError("Project was created but has no default environment");

  return { projectId: project.id, environmentId: env.id };
}

/** Creates a service in the project sourced from a public GitHub repo. */
async function createServiceFromGithub(token, { projectId, name, repo, branch }) {
  const data = await gql(
    token,
    `mutation ServiceCreate($input: ServiceCreateInput!) {
      serviceCreate(input: $input) { id name }
    }`,
    {
      input: {
        projectId,
        name,
        source: { repo },
        branch: branch || undefined,
      },
    }
  );
  return data.serviceCreate;
}

/** Sets/overwrites env vars on a service without redeploying yet. */
async function setVariables(token, { projectId, environmentId, serviceId, variables }) {
  for (const [name, value] of Object.entries(variables)) {
    await gql(
      token,
      `mutation VariableUpsert($input: VariableUpsertInput!) {
        variableUpsert(input: $input)
      }`,
      {
        input: {
          projectId,
          environmentId,
          serviceId,
          name,
          value: String(value),
        },
      }
    );
  }
}

/** Triggers (or re-triggers) a deployment for a service. */
async function deployService(token, { serviceId, environmentId }) {
  const data = await gql(
    token,
    `mutation Deploy($serviceId: String!, $environmentId: String!) {
      serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
    }`,
    { serviceId, environmentId }
  );
  return data.serviceInstanceDeployV2;
}

/** Reads back the current deployment status for a service instance. */
async function getServiceStatus(token, { serviceId, environmentId }) {
  const data = await gql(
    token,
    `query ServiceInstance($serviceId: String!, $environmentId: String!) {
      serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
        latestDeployment { id status createdAt }
      }
    }`,
    { serviceId, environmentId }
  );
  return data.serviceInstance?.latestDeployment || null;
}

/** Creates a Railway TCP Proxy pointed at a fixed container port. */
async function createTcpProxy(token, { environmentId, serviceId, applicationPort }) {
  const data = await gql(
    token,
    `mutation TcpProxyCreate($input: TCPProxyCreateInput!) {
      tcpProxyCreate(input: $input) {
        id
        domain
        proxyPort
        applicationPort
      }
    }`,
    { input: { environmentId, serviceId, applicationPort } }
  );
  return data.tcpProxyCreate;
}

/** Lists existing TCP proxies for a service (useful on "already deployed" runs). */
async function listTcpProxies(token, { environmentId, serviceId }) {
  const data = await gql(
    token,
    `query TcpProxies($environmentId: String!, $serviceId: String!) {
      tcpProxies(environmentId: $environmentId, serviceId: $serviceId) {
        id
        domain
        proxyPort
        applicationPort
      }
    }`,
    { environmentId, serviceId }
  );
  return data.tcpProxies || [];
}

/** Reads recent deployment logs (used to scrape the secret mtg prints on boot). */
async function getDeploymentLogs(token, { deploymentId, limit = 200 }) {
  const data = await gql(
    token,
    `query DeploymentLogs($deploymentId: String!, $limit: Int) {
      deploymentLogs(deploymentId: $deploymentId, limit: $limit) {
        message
      }
    }`,
    { deploymentId, limit }
  );
  return (data.deploymentLogs || []).map((l) => l.message);
}

module.exports = {
  RailwayError,
  verifyToken,
  getWorkspaces,
  createProject,
  createServiceFromGithub,
  setVariables,
  deployService,
  getServiceStatus,
  createTcpProxy,
  listTcpProxies,
  getDeploymentLogs,
};
