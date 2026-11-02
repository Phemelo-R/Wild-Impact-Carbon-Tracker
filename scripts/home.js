'use strict';

/*
  Home dashboard and version-1 JSON backup controls.
  Records are read from this browser only; no operational data is uploaded.
*/
(() => {
  const STORAGE_KEY = 'wild-impact-carbon-tracker-v1';
  const status = document.getElementById('home-storage-status');

  const formatNumber = (value, decimals = 0) => {
    return Number(value || 0).toLocaleString('en-GB', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  const getRecords = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return Array.isArray(stored?.entries) ? stored.entries : [];
    } catch (error) {
      status.textContent = 'Stored records could not be read. Restore your backup.';
      return [];
    }
  };

  const render = () => {
    const records = getRecords();
    const boats = records.filter((record) => {
      return record?.mode === 'boat' &&
        Number.isFinite(Number(record.petrolLitres)) &&
        Number(record.petrolLitres) > 0;
    });

    const petrolLitres = boats.reduce((total, record) => {
      return total + Number(record.petrolLitres);
    }, 0);
    const emissionsKg = boats.reduce((total, record) => {
      return total + WildImpactBoat.calculate(record.petrolLitres).co2eKg;
    }, 0);

    document.getElementById('home-total-records').textContent =
      formatNumber(records.length);
    document.getElementById('home-boat-petrol').textContent =
      formatNumber(petrolLitres, 1);
    document.getElementById('home-boat-emissions').textContent =
      formatNumber(emissionsKg / 1000, 4);
    document.getElementById('home-flight-count').textContent =
      formatNumber(records.filter((record) => record?.mode === 'flight').length);

    status.textContent = `${records.length} records found locally. No data uploaded.`;
  };

  const downloadBackup = () => {
    const backup = {
      schema: 'wild-impact-carbon',
      version: 1,
      exportedAt: new Date().toISOString(),
      entries: getRecords(),
    };
    const file = new Blob([JSON.stringify(backup, null, 2)], {
      type: 'application/json',
    });
    const downloadUrl = URL.createObjectURL(file);
    const link = document.createElement('a');

    link.href = downloadUrl;
    link.download = `Wild-Impact-Carbon-Backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  };

  const validateRecords = (backup) => {
    if (
      backup.schema !== 'wild-impact-carbon' ||
      backup.version !== 1 ||
      !Array.isArray(backup.entries)
    ) {
      throw new Error('Not a recognised version-1 tracker backup.');
    }
    if (backup.entries.length > 100000) {
      throw new Error('Backup has too many records.');
    }

    for (const record of backup.entries) {
      if (
        !record ||
        typeof record !== 'object' ||
        Array.isArray(record) ||
        !['flight', 'ebike', 'boat', 'vehicle'].includes(record.mode) ||
        typeof record.id !== 'string' ||
        record.id.length === 0 ||
        record.id.length > 200 ||
        Object.keys(record).length > 120
      ) {
        throw new Error('Backup contains a malformed record.');
      }

      for (const field of Object.values(record)) {
        const valid =
          (typeof field === 'string' && field.length <= 15000) ||
          (typeof field === 'number' && Number.isFinite(field)) ||
          field === null ||
          typeof field === 'boolean' ||
          (Array.isArray(field) && field.length <= 500 && field.every((item) => {
            return typeof item === 'string' && item.length <= 1000;
          }));
        if (!valid) {
          throw new Error('Backup contains invalid or oversized field data.');
        }
      }
    }
  };

  const restoreBackup = async (file) => {
    if (file.size > 15 * 1024 * 1024) {
      throw new Error('Backup exceeds the 15 MB import limit.');
    }

    const backup = JSON.parse(await file.text());
    validateRecords(backup);

    const proceed = window.confirm(
      `Merge ${backup.entries.length} backup records into this browser? ` +
      'Existing records are preserved unless the backup version is newer.'
    );
    if (!proceed) return;

    const merged = new Map(getRecords().map((record) => [record.id, record]));
    for (const record of backup.entries) {
      const existing = merged.get(record.id);
      if (
        !existing ||
        Date.parse(record.updatedAt || 0) > Date.parse(existing.updatedAt || 0)
      ) {
        merged.set(record.id, record);
      }
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      schema: 'wild-impact-carbon',
      version: 1,
      entries: [...merged.values()],
      exportedAt: new Date().toISOString(),
    }));
    render();
    status.textContent = 'Your backup was merged into this browser.';
  };

  document.getElementById('home-export-backup')
    .addEventListener('click', downloadBackup);

  document.getElementById('home-import-backup')
    .addEventListener('click', () => {
      document.getElementById('home-backup-file').click();
    });

  document.getElementById('home-backup-file')
    .addEventListener('change', async (event) => {
      const file = event.target.files[0];
      if (!file) return;

      try {
        await restoreBackup(file);
      } catch (error) {
        status.textContent = 'Import failed: ' + error.message;
      } finally {
        event.target.value = '';
      }
    });

  render();
})();
