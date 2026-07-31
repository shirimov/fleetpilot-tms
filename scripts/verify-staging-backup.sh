#!/usr/bin/env bash
set -Eeuo pipefail

prefix="${1:?Pass the backup prefix without a file suffix}"
backup_dir="$(cd -- "$(dirname -- "${prefix}")" && pwd)"
backup_name="$(basename "${prefix}")"

database_backup="${backup_dir}/${backup_name}-database.dump.age"
attachment_backup="${backup_dir}/${backup_name}-attachments.tar.gz.age"
manifest="${backup_dir}/${backup_name}.sha256"
completion_marker="${backup_dir}/${backup_name}.complete"

for required_file in \
  "${database_backup}" \
  "${attachment_backup}" \
  "${manifest}" \
  "${completion_marker}"; do
  if [[ ! -f "${required_file}" ]]; then
    echo "Incomplete backup set; required file is missing: ${required_file}" >&2
    exit 1
  fi
done

if [[ "$(cat "${completion_marker}")" != "complete" ]]; then
  echo "Backup completion marker is invalid: ${completion_marker}" >&2
  exit 1
fi

if [[ "$(wc -l < "${manifest}" | tr -d ' ')" != "2" ]]; then
  echo "Backup manifest must contain exactly two archives: ${manifest}" >&2
  exit 1
fi

if ! grep -Fq -- "$(basename "${database_backup}")" "${manifest}" ||
  ! grep -Fq -- "$(basename "${attachment_backup}")" "${manifest}"; then
  echo "Backup manifest does not reference both required archives." >&2
  exit 1
fi

(
  cd "${backup_dir}"
  sha256sum --check "$(basename "${manifest}")"
)

echo "Complete backup set verified: ${prefix}"
