// SPDX-License-Identifier: PMPL-1.0-or-later
// JSON Schema validation for Svalinn requests

// Validation result
type validationError = {
  path: string,
  message: string,
  keyword: string,
}

type validationResult =
  | Valid
  | Invalid(array<validationError>)

// Schema paths (relative to spec/schemas/)
let runRequestSchema = "gateway-run-request.v1.json"
let verifyRequestSchema = "gateway-verify-request.v1.json"
let containerInfoSchema = "container-info.v1.json"
let errorResponseSchema = "error-response.v1.json"

// External AJV validator binding
@module("./validator.mjs")
external validate: (string, JSON.t) => Promise.t<validationResult> = "validate"

@module("./validator.mjs")
external loadSchemas: string => Promise.t<unit> = "loadSchemas"

// Validate run request
let validateRunRequest = async (request: 'a): validationResult => {
  let json = Obj.magic(request)
  await validate(runRequestSchema, json)
}

// Validate verify request
let validateVerifyRequest = async (request: 'a): validationResult => {
  let json = Obj.magic(request)
  await validate(verifyRequestSchema, json)
}

// Check if valid
let isValid = (result: validationResult): bool => {
  switch result {
  | Valid => true
  | Invalid(_) => false
  }
}

// Get errors
let getErrors = (result: validationResult): array<validationError> => {
  switch result {
  | Valid => []
  | Invalid(errors) => errors
  }
}
