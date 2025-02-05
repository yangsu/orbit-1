import { OrbitAPI, API } from "@withorbit/api";
import {
  Attachment,
  AttachmentID,
  AttachmentIDReference,
  PromptID,
  PromptTaskID,
} from "@withorbit/core";
import { APIConfig, defaultAPIConfig } from "./apiConfig";
import { AuthenticationConfig, RequestManager } from "./requestManager";
import { Blob } from "./util/fetch";

export class OrbitAPIClient {
  private requestManager: RequestManager<OrbitAPI.Spec>;

  // TODO: eventually, I'll want to invert control here and bring auth logic into this client.
  constructor(
    authenticateRequest: () => Promise<AuthenticationConfig>,
    config: APIConfig = defaultAPIConfig,
  ) {
    this.requestManager = new RequestManager<OrbitAPI.Spec>(
      config,
      authenticateRequest,
    );
  }

  listTaskStates(
    query: {
      limit?: number;
      createdAfterID?: PromptTaskID;
      dueBeforeTimestampMillis?: number;
    } = {},
  ): Promise<API.RouteResponseData<OrbitAPI.Spec["/taskStates"]["GET"]>> {
    return this.requestManager.request("/taskStates", "GET", {
      query,
    });
  }

  getTaskStates(
    ids: PromptTaskID[],
  ): Promise<API.RouteResponseData<OrbitAPI.Spec["/taskStates"]["GET"]>> {
    return this.requestManager.request("/taskStates", "GET", {
      query: { ids },
    });
  }

  listActionLogs(
    query: OrbitAPI.Spec["/actionLogs"]["GET"]["query"] = {},
  ): Promise<API.RouteResponseData<OrbitAPI.Spec["/actionLogs"]["GET"]>> {
    return this.requestManager.request("/actionLogs", "GET", {
      query,
    });
  }

  storeActionLogs(
    logs: OrbitAPI.Spec["/actionLogs"]["PATCH"]["body"],
  ): Promise<API.RouteResponseData<OrbitAPI.Spec["/actionLogs"]["PATCH"]>> {
    return this.requestManager.request("/actionLogs", "PATCH", {
      body: logs,
    });
  }

  getTaskData(
    ids: PromptID[],
  ): Promise<API.RouteResponseData<OrbitAPI.Spec["/taskData"]["GET"]>> {
    return this.requestManager.request("/taskData", "GET", {
      query: { ids },
    });
  }

  storeTaskData(
    data: OrbitAPI.Spec["/taskData"]["PATCH"]["body"],
  ): Promise<API.RouteResponseData<OrbitAPI.Spec["/taskData"]["PATCH"]>> {
    return this.requestManager.request("/taskData", "PATCH", {
      body: data,
    });
  }

  storeAttachment(
    attachment: Attachment,
  ): Promise<
    OrbitAPI.ResponseObject<
      "attachmentIDReference",
      AttachmentID,
      AttachmentIDReference
    >
  > {
    const blob = new Blob([attachment.contents], { type: attachment.mimeType });
    return this.requestManager.request("/attachments", "POST", {
      contentType: "multipart/form-data",
      body: { file: blob },
    });
  }

  getAttachmentURL(attachmentID: AttachmentID): string {
    return this.requestManager.getRequestURL("/attachments/:id", "GET", {
      params: { id: attachmentID },
    });
  }
}
