/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable no-restricted-imports */
import * as assert from 'assert'
import * as sinon from 'sinon'
import * as fs from 'fs'
import {
    readHyperpodMapping,
    writeHyperpodMapping,
    createConnectionKey,
    storeHyperpodConnection,
    HyperpodMappings,
} from '../../../../awsService/sagemaker/detached-server/hyperpodMappingUtils'

describe('hyperpodMappingUtils', function () {
    let readFileStub: sinon.SinonStub
    let writeFileStub: sinon.SinonStub
    let renameStub: sinon.SinonStub

    beforeEach(function () {
        readFileStub = sinon.stub(fs.promises, 'readFile')
        writeFileStub = sinon.stub(fs.promises, 'writeFile').resolves()
        renameStub = sinon.stub(fs.promises, 'rename').resolves()
    })

    afterEach(function () {
        sinon.restore()
    })

    describe('createConnectionKey', function () {
        it('creates a colon-separated key from workspace, namespace, and cluster', function () {
            const key = createConnectionKey('my-space', 'my-ns', 'my-cluster')
            assert.strictEqual(key, 'my-space:my-ns:my-cluster')
        })

        it('throws if workspaceName contains a colon', function () {
            assert.throws(() => createConnectionKey('bad:name', 'ns', 'cluster'), /cannot contain colon/)
        })

        it('throws if namespace contains a colon', function () {
            assert.throws(() => createConnectionKey('space', 'bad:ns', 'cluster'), /cannot contain colon/)
        })

        it('throws if clusterName contains a colon', function () {
            assert.throws(() => createConnectionKey('space', 'ns', 'bad:cluster'), /cannot contain colon/)
        })
    })

    describe('readHyperpodMapping', function () {
        it('returns parsed JSON from the mapping file', async function () {
            const expected: HyperpodMappings = {
                'space:ns:cluster': {
                    namespace: 'ns',
                    clusterArn: 'arn:aws:sagemaker:us-east-1:123456789012:cluster/cluster',
                    clusterName: 'cluster',
                },
            }
            readFileStub.resolves(JSON.stringify(expected))

            const result = await readHyperpodMapping()
            assert.deepStrictEqual(result, expected)
        })

        it('returns empty object when file does not exist (ENOENT)', async function () {
            const err: any = new Error('File not found')
            err.code = 'ENOENT'
            readFileStub.rejects(err)

            const result = await readHyperpodMapping()
            assert.deepStrictEqual(result, {})
        })

        it('throws on non-ENOENT errors', async function () {
            const err: any = new Error('Permission denied')
            err.code = 'EACCES'
            readFileStub.rejects(err)

            await assert.rejects(() => readHyperpodMapping(), /Failed to read HyperPod mapping file/)
        })
    })

    describe('writeHyperpodMapping', function () {
        it('writes JSON to a temp file and renames it', async function () {
            const mapping: HyperpodMappings = {
                'space:ns:cluster': {
                    namespace: 'ns',
                    clusterArn: 'arn',
                    clusterName: 'cluster',
                },
            }

            await writeHyperpodMapping(mapping)

            assert.ok(writeFileStub.calledOnce)
            const writtenContent = writeFileStub.firstCall.args[1]
            assert.deepStrictEqual(JSON.parse(writtenContent), mapping)
            assert.ok(renameStub.calledOnce)
        })

        it('rejects when writeFile fails', async function () {
            writeFileStub.rejects(new Error('Disk full'))

            await assert.rejects(
                () => writeHyperpodMapping({ 'k:n:c': { namespace: 'n', clusterArn: 'a', clusterName: 'c' } }),
                /Failed to write HyperPod mapping file/
            )
        })
    })

    describe('storeHyperpodConnection', function () {
        it('reads existing mapping, adds new entry, and writes back', async function () {
            readFileStub.resolves(JSON.stringify({}))

            await storeHyperpodConnection(
                'my-space',
                'my-ns',
                'arn:aws:sagemaker:us-east-1:123456789012:cluster/my-cluster',
                'my-cluster',
                'https://endpoint',
                'ca-data',
                'us-east-1',
                'wss://ws-url',
                'token-value',
                'eks-cluster-name',
                { accessKeyId: 'AKIA', secretAccessKey: 'secret', sessionToken: 'session' }
            )

            assert.ok(writeFileStub.calledOnce)
            const written = JSON.parse(writeFileStub.firstCall.args[1])
            const entry = written['my-space:my-ns:my-cluster']
            assert.strictEqual(entry.namespace, 'my-ns')
            assert.strictEqual(entry.clusterName, 'my-cluster')
            assert.strictEqual(entry.endpoint, 'https://endpoint')
            assert.strictEqual(entry.region, 'us-east-1')
            assert.strictEqual(entry.accountId, '123456789012')
            assert.strictEqual(entry.eksClusterName, 'eks-cluster-name')
            assert.strictEqual(entry.credentials?.accessKeyId, 'AKIA')
        })

        it('extracts accountId from clusterArn', async function () {
            readFileStub.resolves(JSON.stringify({}))

            await storeHyperpodConnection(
                'space',
                'ns',
                'arn:aws:sagemaker:us-west-2:999888777666:cluster/c',
                'c'
            )

            const written = JSON.parse(writeFileStub.firstCall.args[1])
            assert.strictEqual(written['space:ns:c'].accountId, '999888777666')
        })
    })
})
