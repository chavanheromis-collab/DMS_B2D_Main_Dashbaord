import test from 'node:test'
import assert from 'node:assert/strict'

import { getDownloadActions } from './downloadActions.js'

test('builds direct-download actions from file link columns', () => {
  const row = {
    Name: 'Sample Project',
    Invoice: 'https://drive.usercontent.google.com/u/0/uc?id=1t2jPfrPRwEVvpboiY5CnaCMcS0udCt4U&export=download',
    Contract: 'https://example.com/contract.pdf',
  }

  assert.deepEqual(getDownloadActions(row, ['Invoice', 'Contract']), [
    {
      column: 'Invoice',
      label: 'Invoice',
      url: 'https://drive.usercontent.google.com/u/0/uc?id=1t2jPfrPRwEVvpboiY5CnaCMcS0udCt4U&export=download',
    },
    {
      column: 'Contract',
      label: 'Contract',
      url: 'https://example.com/contract.pdf',
    },
  ])
})
