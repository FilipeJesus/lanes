# Recover a partial Lanes release

Read this when the target tag exists or a previous run published to any
destination. Work only on the missing stages of the version the user requested.

## Establish what already happened

Check the exact remote tag and its commit, the release run's source SHA, each
registry's publication logs and exact target version, and any existing GitHub
release and assets. A green overall job can hide an Open VSX failure.

The existing workflow can publish both registries and then fail creating an
already-existing tag. Re-running that workflow attempts publication again and
does not repair the missing GitHub release. Do not delete or move the tag or
choose a different version to work around it.

## Both registries published; GitHub release or VSIX is missing

1. Confirm the existing tag points to the intended release commit and the
   successful package/publish steps came from that commit and target version.
2. Obtain the already-published VSIX for that exact version using the registry's
   version-specific download link. Open VSX can provide the published VSIX.
   The current Release workflow does not upload an Actions artifact: do not
   assume `gh run download` can retrieve its package.
3. Inspect the downloaded archive's `extension/package.json` and VSIX manifest.
   Confirm version, publisher `FilipeMarquesJesus`, and extension name `lanes`.
   Compare a registry-provided checksum if available and retain source
   provenance from the original run. Do not attach a package of uncertain
   origin or from a different version.
4. If the GitHub release is absent, create only that release and attach the
   verified package, requiring the tag to exist:

   ```bash
   gh release create "v$TARGET_VERSION" "$VSIX_PATH" --repo "$REPO" --verify-tag --generate-notes --title "v$TARGET_VERSION"
   ```

   If the release already exists and only the asset is missing, upload only the
   missing asset. Do not overwrite an existing asset or recreate a complete
   release.
5. Verify the published release, downloadable VSIX, and unchanged tag commit.
   Preserve Auto Tag Release's initial state. The historical workflow run can
   remain failed even after the missing release is repaired.

Stop and explain the remaining stage if the existing tag has unexpected
provenance, a trustworthy VSIX cannot be obtained, or required access is
unavailable. Do not republish registries merely to generate a downloadable file.

## Other partial states

If only one registry succeeded, determine the exact missing destination and
whether the authorized release can finish just that stage with the verified
package and available credentials. Do not rerun successful destinations or
alter workflow definitions as an implicit part of recovery.

Only retry an entire failed run for a transient error after confirming no
registry publication, target tag, or GitHub release was created. Restore any
workflow state changed by this task before reporting success or handing back
an incomplete result.
