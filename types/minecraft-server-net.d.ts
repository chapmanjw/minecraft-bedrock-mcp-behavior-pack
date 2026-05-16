// Vendored ambient declarations for the `@minecraft/server-net` Script API.
//
// `@minecraft/server-net` lets the behavior pack make outbound HTTP requests
// from inside the world — the transport the bridge client is built on. It is a
// beta module and requires the "Beta APIs" experiment enabled on the world.
// See https://learn.microsoft.com/minecraft/creator/scriptapi/minecraft/server-net/

declare module "@minecraft/server-net" {
  export enum HttpRequestMethod {
    Get = "Get",
    Head = "Head",
    Post = "Post",
    Put = "Put",
    Delete = "Delete",
    Patch = "Patch",
  }

  /**
   * A header value: either a literal string, or a `SecretString` whose secret
   * is resolved into the header at request time without exposing it to script.
   */
  export type HeaderValue = string | import("@minecraft/server-admin").SecretString;

  export class HttpHeader {
    constructor(key: string, value: HeaderValue);
    key: string;
    value: HeaderValue;
  }

  export class HttpRequest {
    constructor(uri: string);
    uri: string;
    method: HttpRequestMethod;
    body: string;
    headers: HttpHeader[];
    /** Request timeout, in seconds. */
    timeout: number;
    addHeader(key: string, value: HeaderValue): HttpRequest;
    setBody(body: string): HttpRequest;
    setHeaders(headers: HttpHeader[]): HttpRequest;
    setMethod(method: HttpRequestMethod): HttpRequest;
    setTimeout(timeout: number): HttpRequest;
  }

  export class HttpResponse {
    readonly request: HttpRequest;
    readonly status: number;
    readonly body: string;
    readonly headers: HttpHeader[];
  }

  export class HttpClient {
    request(config: HttpRequest): Promise<HttpResponse>;
    get(uri: string): Promise<HttpResponse>;
  }

  export const http: HttpClient;
}
