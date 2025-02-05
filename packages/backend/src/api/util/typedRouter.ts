import { API } from "@withorbit/api";
import Busboy from "busboy";
import express from "express";
import Blob from "fetch-blob";
import { Writable } from "stream";

// Adapted from https://github.com/rawrmaan/restyped-express-async

export interface TypedRequest<Route extends API.RouteData>
  extends express.Request<Route["params"]> {
  // TODO: params
  body: Route["body"];
  query: Route["query"];
}

type TypedAPIImplementation<API extends API.Spec> = {
  [Path in Extract<keyof API, string>]: TypedRouteList<API, Path>;
};

type TypedRouteList<
  API extends API.Spec,
  Path extends Extract<keyof API, string>
> = {
  [Method in Extract<keyof API[Path], API.HTTPMethod>]: TypedRouteHandler<
    API,
    Path,
    Method
  >;
};

export type TypedRouteHandler<
  API extends API.Spec,
  Path extends Extract<keyof API, string>,
  Method extends Extract<keyof API[Path], API.HTTPMethod>
> = (
  request: TypedRequest<API[Path][Method]>,
) => Promise<TypedResponse<API.RouteResponseData<API[Path][Method]>>>;

export type TypedResponse<Data> = (
  | { status: 200 | 201; json: Data; cachePolicy: CachePolicy }
  | { status: 204 }
  | { status: 301 | 302; redirectURL: string; cachePolicy: CachePolicy }
  | { status: 400 | 401 }
) & { headers?: { [name: string]: string } };

// We use a simplified set of caching policies.
export enum CachePolicy {
  Immutable = "public, max-age=86400, immutable", // can be cached by any layer for an extended period
  NoStore = "no-store, max-age=0", // no layer should cache this response at all
}

export default function createTypedRouter<API extends API.Spec>(
  app: express.Express | express.Router,
  handlers: TypedAPIImplementation<API>,
) {
  type APIPaths = Extract<keyof API, string>;
  type APIRoutes<Path extends APIPaths> = Extract<
    keyof API[Path],
    API.HTTPMethod
  >;

  function createRoute<Path extends APIPaths, Method extends APIRoutes<Path>>(
    path: Path,
    baseRouteMatcher: express.IRouterMatcher<void>,
    handler: TypedRouteHandler<API, Path, Method>,
  ) {
    baseRouteMatcher(path, async function (request, response, next) {
      if (request.header("Content-Type")?.startsWith("multipart/form-data")) {
        const { fields, uploads } = await extractMultipartFormData(request);
        request.body = { ...fields, ...uploads };
      }

      const urlPathParametersValidation = validateURLPathParams(path, request);
      if (urlPathParametersValidation.status === "failure") {
        console.error(urlPathParametersValidation.error);
        response.sendStatus(400);
        return;
      }

      // TODO: validate request data

      return handler(request as TypedRequest<API[Path][Method]>)
        .then((result) => {
          response.status(result.status);

          for (const [name, value] of Object.entries(result.headers ?? {})) {
            response.setHeader(name, value);
          }

          if (result.status === 301 || result.status === 302) {
            response.header("Location", result.redirectURL);
          }

          if ("cachePolicy" in result) {
            response.header("Cache-Control", result.cachePolicy);
          }

          if (result.status === 200) {
            response.json(result.json);
          } else {
            response.send();
          }
        })
        .catch((err) => next(err));
    });
  }

  const baseRouteMatchers: {
    [Method in API.HTTPMethod]: express.IRouterMatcher<void>;
  } = {
    GET: app.get.bind(app),
    POST: app.post.bind(app),
    PUT: app.put.bind(app),
    PATCH: app.patch.bind(app),
    HEAD: app.head.bind(app),
    DELETE: app.delete.bind(app),
    OPTIONS: app.options.bind(app),
  };

  for (const path of Object.keys(handlers) as (keyof typeof handlers)[]) {
    const methods = handlers[path] as TypedRouteList<API, typeof path>;
    for (const method of Object.keys(
      handlers[path],
    ) as (keyof typeof methods)[]) {
      createRoute(path, baseRouteMatchers[method], handlers[path][method]);
    }
  }
}

function extractMultipartFormData(
  request: express.Request,
): Promise<{
  fields: API.RequestFormData;
  uploads: { [fieldname: string]: Blob };
}> {
  return new Promise((resolve, reject) => {
    if (request.method != "POST") {
      return reject(405);
    } else {
      const busboy = new Busboy({ headers: request.headers });
      const fields: API.RequestFormData = {};
      const uploads: { [fieldname: string]: Blob } = {};
      const writePromises: Promise<unknown>[] = [];

      busboy.on("field", (fieldname, val) => (fields[fieldname] = val));

      busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
        const chunks: Buffer[] = [];
        const writable = new Writable({
          write(chunk, encoding, next) {
            chunks.push(chunk);
            next();
          },
        });

        file.pipe(writable);

        const promise = new Promise((resolve, reject) => {
          file.on("end", () => {
            uploads[fieldname] = new Blob(chunks, { type: mimetype });
          });
          writable.on("finish", resolve);
          writable.on("error", reject);
        });
        writePromises.push(promise);
      });

      busboy.on("finish", async () => {
        const result = { fields, uploads };
        await Promise.all(writePromises);
        resolve(result);
      });

      busboy.on("error", reject);

      // GCS munges multipart requests in a way which prevents direct piping into Busboy, but it adds a rawBody field containing the original body. https://cloud.google.com/functions/docs/writing/http#handling_multipart_form_uploads
      const { rawBody } = request as express.Request & { rawBody?: Buffer };
      if (rawBody) {
        busboy.end(rawBody);
      } else {
        request.pipe(busboy);
      }
    }
  });
}

function validateURLPathParams(
  path: string,
  request: express.Request,
): { status: "success" } | { status: "failure"; error: Error } {
  const templatePathComponents = path.split("/");

  for (let i = 0; i < templatePathComponents.length; i++) {
    const templatePathComponent = templatePathComponents[i];
    if (templatePathComponent.startsWith(":")) {
      const parameterName = templatePathComponent.slice(1);
      if (!request.params[parameterName]) {
        return {
          status: "failure",
          error: new Error(`Missing URL path parameter ${parameterName}`),
        };
      }
    }
  }
  return { status: "success" };
}
