// SPDX-License-Identifier: PMPL-1.0-or-later
// Deno runtime bindings for ReScript

// Environment
module Env = {
  @scope(("Deno", "env")) @val
  external get: string => option<string> = "get"

  @scope(("Deno", "env")) @val
  external set: (string, string) => unit = "set"

  @scope(("Deno", "env")) @val
  external toObject: unit => dict<string> = "toObject"
}

// File system
module Fs = {
  @scope("Deno") @val
  external readTextFile: string => Promise.t<string> = "readTextFile"

  @scope("Deno") @val
  external writeTextFile: (string, string) => Promise.t<unit> = "writeTextFile"

  @scope("Deno") @val
  external remove: string => Promise.t<unit> = "remove"

  @scope("Deno") @val
  external mkdir: (string, {..}) => Promise.t<unit> = "mkdir"

  type fileInfo = {
    isFile: bool,
    isDirectory: bool,
    size: int,
  }

  @scope("Deno") @val
  external stat: string => Promise.t<fileInfo> = "stat"
}

// HTTP server
module Http = {
  type conn = {
    remoteAddr: {"transport": string, "hostname": string, "port": int},
  }

  type request = {
    method: string,
    url: string,
    headers: Fetch.Headers.t,
    body: option<Fetch.Body.t>,
  }

  type serveOptions<'a> = {
    port: int,
    hostname: option<string>,
    signal: option<'a>,
  }

  @scope("Deno") @val
  external serve: (
    (Fetch.Request.t) => Promise.t<Fetch.Response.t>,
    serveOptions<JSON.t>,
  ) => {..} = "serve"
}

// Standard I/O
module Io = {
  @scope("Deno") @val
  external stdin: {..} = "stdin"

  @scope("Deno") @val
  external stdout: {..} = "stdout"

  @scope("Deno") @val
  external stderr: {..} = "stderr"
}

// Process
@scope("Deno") @val
external exit: int => unit = "exit"

@scope("Deno") @val
external args: array<string> = "args"

// AbortController binding
module AbortController = {
  type t
  type signal

  @new external make: unit => t = "AbortController"

  @get external signal: t => signal = "signal"
  @send external abort: t => unit = "abort"
}
