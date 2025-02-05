import {
  ActionLogID,
  qaPromptType,
  getIDForPrompt,
  getIDForPromptTask,
  PromptRepetitionOutcome,
  PromptTaskID,
  repetitionActionLogType,
} from "@withorbit/core";
import {
  ActionLogDocument,
  PromptStateCache,
  ServerTimestamp,
} from "@withorbit/firebase-support";
import { testQAPrompt } from "@withorbit/sample-data";
import applyPromptActionLogToPromptStateCache from "./applyPromptActionLogToPromptStateCache";

let promptTaskID: PromptTaskID;
beforeAll(async () => {
  promptTaskID = getIDForPromptTask({
    promptID: await getIDForPrompt(testQAPrompt),
    promptParameters: null,
    promptType: qaPromptType,
  });
});

function createRepetitionLog(
  parentActionLogIDs: ActionLogID[],
  serverTimestamp: ServerTimestamp,
): ActionLogDocument<ServerTimestamp> {
  return {
    actionLogType: repetitionActionLogType,
    timestampMillis: 100,
    parentActionLogIDs,
    taskID: promptTaskID,
    taskParameters: null,
    context: null,
    outcome: PromptRepetitionOutcome.Remembered,
    serverTimestamp,
  };
}

describe("timestamps", () => {
  let firstRepetition: ActionLogDocument<ServerTimestamp>;
  let initialPromptState: PromptStateCache;
  beforeAll(async () => {
    firstRepetition = createRepetitionLog([], {
      seconds: 1000,
      nanoseconds: 0,
    });

    initialPromptState = (await applyPromptActionLogToPromptStateCache({
      actionLogDocument: firstRepetition,
      basePromptStateCache: null,
      fetchAllActionLogDocumentsForTask: jest.fn(),
    })) as PromptStateCache;
  });

  test("updates to newer timestamp", async () => {
    const newPromptState = (await applyPromptActionLogToPromptStateCache({
      actionLogDocument: createRepetitionLog([], {
        seconds: 2000,
        nanoseconds: 0,
      }),
      basePromptStateCache: initialPromptState,
      fetchAllActionLogDocumentsForTask: jest.fn(),
    })) as PromptStateCache;
    expect(newPromptState.latestLogServerTimestamp.seconds).toEqual(2000);
  });

  test("doesn't update for older timestamps", async () => {
    const newPromptState = (await applyPromptActionLogToPromptStateCache({
      actionLogDocument: createRepetitionLog([], {
        seconds: 500,
        nanoseconds: 0,
      }),
      basePromptStateCache: initialPromptState,
      fetchAllActionLogDocumentsForTask: jest.fn(),
    })) as PromptStateCache;
    expect(newPromptState.latestLogServerTimestamp.seconds).toEqual(1000);
  });
});
