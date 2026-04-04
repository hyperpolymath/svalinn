// SPDX-License-Identifier: PMPL-1.0-or-later
/**
 * Policy Store for Svalinn
 * Fully ported to ReScript v12
 */

open PolicyTypes

module Deno = {
  @val @scope("Deno") external readTextFile: string => promise<string> = "readTextFile"
  @val @scope("Deno") external writeTextFile: (string, string) => promise<unit> = "writeTextFile"
  @val @scope("Deno") external readDir: string => 'asyncIterable = "readDir"
}

module PolicyStore = {
  type t = {
    policyDir: string,
    cache: Map.t<string, Types.edgePolicy>,
  }

  let make = (policyDir: string) => {
    {
      policyDir: policyDir,
      cache: Map.make(),
    }
  }

  let loadPolicy = async (self: t, name: string): option<Types.edgePolicy> => {
    switch self.cache->Map.get(name) {
    | Some(p) => Some(p)
    | None => {
        try {
          let path = `${self.policyDir}/${name}.json`
          let content = await Deno.readTextFile(path)
          let policy: Types.edgePolicy = JSON.parseExn(content)->Obj.magic
          self.cache->Map.set(name, policy)
          Some(policy)
        } catch {
        | _ => None
        }
      }
    }
  }

  let listPolicies = async (self: t): array<string> => {
    let policies = []
    let _iter = Deno.readDir(self.policyDir)
    let _ = %raw(`
      async function() {
        for await (const entry of iter) {
          if (entry.isFile && entry.name.endsWith(".json")) {
            policies.push(entry.name.replace(".json", ""));
          }
        }
      }
    `)()
    policies
  }
}
