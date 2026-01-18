// SPDX-License-Identifier: PMPL-1.0-or-later
// Request handlers for Svalinn gateway

open Types

// External Vörðr client reference
@module("../vordr/Client.res.mjs")
external vordrClient: VordrClient.t = "client"

// Health check handler
let healthHandler = async (): healthResponse => {
  let vordrConnected = await VordrClient.ping(vordrClient)
  {
    status: "healthy",
    version: "0.1.0",
    vordrConnected,
    timestamp: Date.now()->Float.toString,
  }
}

// List containers handler
let containersHandler = async (): array<containerInfo> => {
  await VordrClient.listContainers(vordrClient)
}

// List images handler
let imagesHandler = async (): array<imageInfo> => {
  await VordrClient.listImages(vordrClient)
}

// Run container handler
let runHandler = async (request: runRequest): containerInfo => {
  // First validate the request
  let _validationResult = await Validation.validateRunRequest(request)
  // Then verify the image
  let _verifyResult = await VordrClient.verifyImage(
    vordrClient,
    request.imageName,
    request.imageDigest,
  )
  // Finally run via Vörðr
  await VordrClient.runContainer(vordrClient, request)
}

// Verify image handler
let verifyHandler = async (request: verifyRequest): verificationResult => {
  await VordrClient.verifyImage(
    vordrClient,
    request.imageRef,
    "",
  )
}

// Stop container handler
let stopHandler = async (containerId: string): unit => {
  await VordrClient.stopContainer(vordrClient, containerId)
}

// Remove container handler
let removeHandler = async (containerId: string): unit => {
  await VordrClient.removeContainer(vordrClient, containerId)
}

// Inspect container handler
let inspectHandler = async (containerId: string): containerInfo => {
  await VordrClient.inspectContainer(vordrClient, containerId)
}
