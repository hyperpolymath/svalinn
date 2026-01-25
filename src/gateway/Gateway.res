// SPDX-License-Identifier: PMPL-1.0-or-later
// Svalinn Edge Gateway - Main HTTP server

// Configuration
module Config = {
  @scope("Deno") @val external getEnv: string => option<string> = "env.get"

  let port = getEnv("SVALINN_PORT")
    ->Belt.Option.flatMap(Belt.Int.fromString)
    ->Belt.Option.getWithDefault(8000)

  let host = getEnv("SVALINN_HOST")->Belt.Option.getWithDefault("0.0.0.0")

  let vordrEndpoint = getEnv("VORDR_ENDPOINT")->Belt.Option.getWithDefault("http://localhost:8080")

  let specVersion = getEnv("SPEC_VERSION")->Belt.Option.getWithDefault("v0.1.0")

  let enableAuth = getEnv("AUTH_ENABLED") == Some("true")

  let logLevel = getEnv("LOG_LEVEL")->Belt.Option.getWithDefault("info")
}

// Logging
module Log = {
  type level = Debug | Info | Warn | Error

  let levelToString = (level: level): string => {
    switch level {
    | Debug => "DEBUG"
    | Info => "INFO"
    | Warn => "WARN"
    | Error => "ERROR"
    }
  }

  let shouldLog = (level: level): bool => {
    switch (Config.logLevel, level) {
    | ("debug", _) => true
    | ("info", Debug) => false
    | ("info", _) => true
    | ("warn", Debug | Info) => false
    | ("warn", _) => true
    | ("error", Error) => true
    | (_, _) => false
    }
  }

  let log = (level: level, message: string, ~metadata: option<Js.Json.t>=?, ()) => {
    if shouldLog(level) {
      let timestamp = %raw(`new Date().toISOString()`)
      let logObj = switch metadata {
      | Some(meta) =>
        Js.Json.object_(
          Js.Dict.fromArray([
            ("timestamp", Js.Json.string(timestamp)),
            ("level", Js.Json.string(levelToString(level))),
            ("message", Js.Json.string(message)),
            ("metadata", meta),
          ])
        )
      | None =>
        Js.Json.object_(
          Js.Dict.fromArray([
            ("timestamp", Js.Json.string(timestamp)),
            ("level", Js.Json.string(levelToString(level))),
            ("message", Js.Json.string(message)),
          ])
        )
      }
      Js.Console.log(Js.Json.stringify(logObj))
    }
  }

  let debug = (message: string, ~metadata: option<Js.Json.t>=?, ()) =>
    log(Debug, message, ~metadata?, ())

  let info = (message: string, ~metadata: option<Js.Json.t>=?, ()) =>
    log(Info, message, ~metadata?, ())

  let warn = (message: string, ~metadata: option<Js.Json.t>=?, ()) =>
    log(Warn, message, ~metadata?, ())

  let error = (message: string, ~metadata: option<Js.Json.t>=?, ()) =>
    log(Error, message, ~metadata?, ())
}

// Health check endpoint
module HealthCheck = {
  let handler = async (c: Hono.Context.t<'env, 'path>): Hono.Response.t => {
    // Check Vörðr connectivity
    let vordrConnected = try {
      let response = await Fetch.fetch(Config.vordrEndpoint ++ "/health")
      Fetch.Response.ok(response)
    } catch {
    | _ => false
    }

    let status = if vordrConnected {"healthy"} else {"degraded"}

    Hono.Context.json(
      c,
      Js.Json.object_(
        Js.Dict.fromArray([
          ("status", Js.Json.string(status)),
          ("version", Js.Json.string("0.1.0")),
          ("vordrConnected", Js.Json.boolean(vordrConnected)),
          ("specVersion", Js.Json.string(Config.specVersion)),
          ("timestamp", Js.Json.string(%raw(`new Date().toISOString()`))),
        ])
      ),
      ~status=200,
      ()
    )
  }
}

// Readiness check endpoint
module ReadinessCheck = {
  let handler = async (c: Hono.Context.t<'env, 'path>): Hono.Response.t => {
    // Check if Vörðr is reachable
    let ready = try {
      let response = await Fetch.fetch(Config.vordrEndpoint ++ "/health")
      Fetch.Response.ok(response)
    } catch {
    | _ => false
    }

    if ready {
      Hono.Context.json(
        c,
        Js.Json.object_(Js.Dict.fromArray([("ready", Js.Json.boolean(true))])),
        ~status=200,
        ()
      )
    } else {
      Hono.Context.json(
        c,
        Js.Json.object_(
          Js.Dict.fromArray([
            ("ready", Js.Json.boolean(false)),
            ("reason", Js.Json.string("Vörðr unavailable")),
          ])
        ),
        ~status=503,
        ()
      )
    }
  }
}

// Metrics endpoint
module Metrics = {
  let handler = (c: Hono.Context.t<'env, 'path>): Hono.Response.t => {
    // Placeholder for Prometheus metrics
    // In production, collect actual metrics
    Hono.Context.text(
      c,
      "# HELP svalinn_requests_total Total HTTP requests
# TYPE svalinn_requests_total counter
svalinn_requests_total 0

# HELP svalinn_request_duration_seconds HTTP request duration
# TYPE svalinn_request_duration_seconds histogram
svalinn_request_duration_seconds_bucket{le=\"0.1\"} 0
svalinn_request_duration_seconds_bucket{le=\"0.5\"} 0
svalinn_request_duration_seconds_bucket{le=\"1\"} 0
svalinn_request_duration_seconds_bucket{le=\"+Inf\"} 0
svalinn_request_duration_seconds_sum 0
svalinn_request_duration_seconds_count 0
",
      ~status=200,
      ()
    )
  }
}

// Request logging middleware
let requestLogger = (): Hono.middleware<'env, 'path> => {
  async (c, next) => {
    let req = Hono.Context.req(c)
    let method = Hono.Request.method_(req)
    let url = Hono.Request.url(req)
    let start = Js.Date.now()

    Log.info(
      "Incoming request",
      ~metadata=Js.Json.object_(
        Js.Dict.fromArray([("method", Js.Json.string(method)), ("url", Js.Json.string(url))])
      ),
      ()
    )

    await next()

    let duration = Js.Date.now() -. start
    Log.info(
      "Request completed",
      ~metadata=Js.Json.object_(
        Js.Dict.fromArray([
          ("method", Js.Json.string(method)),
          ("url", Js.Json.string(url)),
          ("duration_ms", Js.Json.number(duration)),
        ])
      ),
      ()
    )
  }
}

// CORS middleware
let cors = (): Hono.middleware<'env, 'path> => {
  async (c, next) => {
    Hono.Context.header(c, "Access-Control-Allow-Origin", "*")
    Hono.Context.header(c, "Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
    Hono.Context.header(c, "Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key")

    let req = Hono.Context.req(c)
    if Hono.Request.method_(req) == "OPTIONS" {
      Hono.Context.text(c, "", ~status=204, ())
    } else {
      await next()
    }
  }
}

// Error handler middleware
let errorHandler = (): Hono.middleware<'env, 'path> => {
  async (c, next) => {
    try {
      await next()
    } catch {
    | Js.Exn.Error(e) => {
        let message = Js.Exn.message(e)->Belt.Option.getWithDefault("Internal server error")
        Log.error("Request error", ~metadata=Js.Json.object_(Js.Dict.fromArray([
          ("error", Js.Json.string(message))
        ])), ())

        Hono.Context.json(
          c,
          Js.Json.object_(
            Js.Dict.fromArray([
              ("error", Js.Json.string("Internal Server Error")),
              ("message", Js.Json.string(message)),
            ])
          ),
          ~status=500,
          ()
        )
      }
    }
  }
}

// Create Hono app
let createApp = (): Hono.t<'env> => {
  let app = Hono.make()

  // Global middleware
  app->Hono.use(errorHandler())
  app->Hono.use(requestLogger())
  app->Hono.use(cors())

  // Health/readiness endpoints (no auth required)
  app->Hono.get("/health", HealthCheck.handler)->ignore
  app->Hono.get("/healthz", HealthCheck.handler)->ignore
  app->Hono.get("/ready", ReadinessCheck.handler)->ignore
  app->Hono.get("/readyz", ReadinessCheck.handler)->ignore
  app->Hono.get("/metrics", Metrics.handler)->ignore

  // Authentication middleware (applied to all routes below)
  if Config.enableAuth {
    let authConfig = Middleware.loadAuthConfigFromEnv()
    app->Hono.use(Middleware.authMiddleware(authConfig))->ignore
    Log.info("Authentication enabled", ())
  } else {
    Log.warn("Authentication DISABLED - not for production!", ())
  }

  // API routes (TODO: implement in separate modules)
  // Containers
  app->Hono.get("/api/v1/containers", async c => {
    Hono.Context.json(
      c,
      Js.Json.object_(Js.Dict.fromArray([("containers", Js.Json.array([]))])),
      ()
    )
  })->ignore

  // Images
  app->Hono.get("/api/v1/images", async c => {
    Hono.Context.json(c, Js.Json.object_(Js.Dict.fromArray([("images", Js.Json.array([]))])), ())
  })->ignore

  // Run container
  app->Hono.post("/api/v1/run", async c => {
    Hono.Context.json(
      c,
      Js.Json.object_(
        Js.Dict.fromArray([("error", Js.Json.string("Not implemented yet"))])
      ),
      ~status=501,
      ()
    )
  })->ignore

  // Verify bundle
  app->Hono.post("/api/v1/verify", async c => {
    Hono.Context.json(
      c,
      Js.Json.object_(
        Js.Dict.fromArray([("error", Js.Json.string("Not implemented yet"))])
      ),
      ~status=501,
      ()
    )
  })->ignore

  // Policies
  app->Hono.get("/api/v1/policies", async c => {
    Hono.Context.json(c, Js.Json.object_(Js.Dict.fromArray([("policies", Js.Json.array([]))])), ())
  })->ignore

  // 404 handler
  app->Hono.all("*", async c => {
    let req = Hono.Context.req(c)
    let url = Hono.Request.url(req)

    Hono.Context.json(
      c,
      Js.Json.object_(
        Js.Dict.fromArray([
          ("error", Js.Json.string("Not Found")),
          ("path", Js.Json.string(url)),
        ])
      ),
      ~status=404,
      ()
    )
  })->ignore

  app
}

// Start server
let serve = () => {
  let app = createApp()

  Log.info(
    "Starting Svalinn Gateway",
    ~metadata=Js.Json.object_(
      Js.Dict.fromArray([
        ("port", Js.Json.number(Belt.Int.toFloat(Config.port))),
        ("host", Js.Json.string(Config.host)),
        ("vordrEndpoint", Js.Json.string(Config.vordrEndpoint)),
        ("authEnabled", Js.Json.boolean(Config.enableAuth)),
      ])
    ),
    ()
  )

  // Deno.serve wrapper
  let handler = (req: Fetch.Request.t) => {
    app->Hono.fetch(req, %raw(`{}`))
  }

  let options = {
    "port": Config.port,
    "hostname": Config.host,
  }

  %raw(`Deno.serve(options, handler)`)
}
