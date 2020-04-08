import { GherkinStreams } from '../src'
import { IdGenerator, messages } from '@cucumber/messages'
import { pipeline, Readable, Writable } from 'stream'
import assert from 'assert'
import Query from '../src/Query'
import { promisify } from 'util'

const pipelinePromise = promisify(pipeline)

describe('Query', () => {
  let gherkinQuery: Query
  let envelopes: messages.IEnvelope[]
  beforeEach(() => {
    envelopes = []
    gherkinQuery = new Query()
  })

  describe('#getLocation(astNodeId)', () => {
    it('looks up a scenario line number', async () => {
      await parse(
        `Feature: hello
  Scenario: hi
    Given a passed step
`
      )
      const pickle = envelopes.find((e) => e.pickle).pickle
      const gherkinScenarioId = pickle.astNodeIds[0]
      const location = gherkinQuery.getLocation(gherkinScenarioId)
      assert.deepStrictEqual(location.line, 2)
    })

    it('looks up a step line number', async () => {
      await parse(
        `Feature: hello
  Scenario: hi
    Given a passed step
`
      )
      const pickleStep = envelopes.find((e) => e.pickle).pickle.steps[0]
      const gherkinStepId = pickleStep.astNodeIds[0]
      const location = gherkinQuery.getLocation(gherkinStepId)
      assert.deepStrictEqual(location.line, 3)
    })
  })

  describe('#getPickleIds(uri, lineNumber)', () => {
    it('looks up pickle IDs for a scenario', async () => {
      await parse(
        `Feature: hello
  Background:
    Given a background step

  Scenario: hi
    Given a passed step
`
      )
      const pickleId = envelopes.find((e) => e.pickle).pickle.id
      const pickleIds = gherkinQuery.getPickleIds('test.feature', 5)
      assert.deepStrictEqual(pickleIds, [pickleId])
    })

    it('looks up pickle IDs for a whole document', async () => {
      await parse(
        `Feature: hello
  Scenario:
    Given a failed step

  Scenario: hi
    Given a passed step
`
      )
      const expectedPickleIds = envelopes
        .filter((e) => e.pickle)
        .map((e) => e.pickle.id)
      const pickleIds = gherkinQuery.getPickleIds('test.feature')
      assert.deepStrictEqual(pickleIds, expectedPickleIds)
    })

    it.skip('fails to look up pickle IDs for a step', async () => {
      await parse(
        `Feature: hello
  Background:
    Given a background step

  Scenario: hi
    Given a passed step
`
      )

      assert.throws(() => gherkinQuery.getPickleIds('test.feature', 6), {
        message: 'No values found for key 6. Keys: [5]',
      })
    })

    it('avoids dupes and ignores empty scenarios', async () => {
      await parse(
        `Feature: Examples and empty scenario

  Scenario: minimalistic
    Given the <what>

    Examples:
      | what |
      | foo  |

    Examples:
      | what |
      | bar  |

  Scenario: ha ok
`
      )

      const pickleIds = gherkinQuery.getPickleIds('test.feature')
      // One for each table, and one for the empty scenario
      // https://github.com/cucumber/cucumber/issues/249
      assert.strictEqual(pickleIds.length, 3, pickleIds.join(','))
    })
  })

  describe('#getPickleIdsFromAtNodeId(astNodeId)', () => {
    it('returns the pickle ID generated from a scenario', async () => {
      await parse(
        `Feature: hello
  Scenario: hi
    Given a passed step
`
      )

      const pickleIds = envelopes
        .filter((envelope) => envelope.pickle)
        .map((envelope) => envelope.pickle.id)

      const gherkinDocument = envelopes.find(
        (envelope) => envelope.gherkinDocument
      ).gherkinDocument

      const scenario = gherkinDocument.feature.children.find(
        (child) => child.scenario
      ).scenario

      assert.deepEqual(
        gherkinQuery.getPickleIdsFromAtNodeId(scenario.id),
        pickleIds
      )
    })

    it('returns an empty list for unknown ids', async () => {
      await parse(`Feature: hello`)

      assert.deepEqual(
        gherkinQuery.getPickleIdsFromAtNodeId('this-id-not-an-exiting-id'),
        []
      )
    })

    it('returns multiple IDs when multiple pickles are generated', async () => {
      await parse(
        `Feature: hello
  Scenario: hi
    Given a <status> step

    Examples:
      | status |
      | passed |
      | failed |
    `
      )

      const gherkinDocument = envelopes.find(
        (envelope) => envelope.gherkinDocument
      ).gherkinDocument

      const scenario = gherkinDocument.feature.children.find(
        (child) => child.scenario
      ).scenario

      assert.equal(gherkinQuery.getPickleIdsFromAtNodeId(scenario.id).length, 2)
    })
  })

  describe('#getPickleStepIds(uri, lineNumber)', () => {
    it('looks up pickle step IDs for a step', async () => {
      await parse(
        `Feature: hello
  Scenario: hi
    Given a passed step
`
      )
      const pickleStepId = envelopes.find((e) => e.pickle).pickle.steps[0].id
      const pickleStepIds = gherkinQuery.getPickleStepIds('test.feature', 3)
      assert.deepStrictEqual(pickleStepIds, [pickleStepId])
    })

    it('looks up pickle step IDs for a background step followed by an empty scenario', async () => {
      await parse(`Feature: Incomplete scenarios

  Background:
    Given a passed step

  Scenario: no steps
`)

      const pickleStepIds = gherkinQuery.getPickleStepIds('test.feature', 4)
      assert.deepStrictEqual(pickleStepIds, [])
    })

    it.skip('fails to looks up pickle step IDs for a pickle', async () => {
      await parse(
        `Feature: hello
  Scenario: hi
    Given a passed step
`
      )
      assert.throws(() => gherkinQuery.getPickleStepIds('test.feature', 2), {
        message: 'No values found for key 2. Keys: [3]',
      })
    })
  })

  describe('#getPickleStepIdsFromAstNodeId(astNodeId', () => {
    it('returns an empty list when the ID is unknown', async () => {
      await parse('Feature: An empty feature')

      assert.deepEqual(
        gherkinQuery.getPickleStepIdsFromAstNodeId('whetever-id'),
        []
      )
    })

    it('returns the pickle step IDs corresponding the a scenario step', async () => {
      await parse(
        `Feature: hello
  Scenario:
    Given a failed step
`
      )

      const pickleStepIds = envelopes
        .find((envelope) => envelope.pickle)
        .pickle.steps.map((pickleStep) => pickleStep.id)

      const stepId = envelopes.find((envelope) => envelope.gherkinDocument)
        .gherkinDocument.feature.children[0].scenario.steps[0].id

      assert.deepEqual(
        gherkinQuery.getPickleStepIdsFromAstNodeId(stepId),
        pickleStepIds
      )
    })

    context('when a step has multiple pickle step', () => {
      it('returns all pickleStepIds linked to a background step', async () => {
        await parse(
          `Feature: hello
  Background:
    Given a step that will have 2 pickle steps

  Scenario:
    Given a step that will only have 1 pickle step

    Scenario:
    Given a step that will only have 1 pickle step
  `
        )

        const backgroundStepId = envelopes.find(
          (envelope) => envelope.gherkinDocument
        ).gherkinDocument.feature.children[0].background.steps[0].id

        const pickleStepIds = envelopes
          .filter((envelope) => envelope.pickle)
          .map((envelope) => envelope.pickle.steps[0].id)

        assert.deepEqual(
          gherkinQuery.getPickleStepIdsFromAstNodeId(backgroundStepId),
          pickleStepIds
        )
      })

      it('return all pickleStepIds linked to a tep in a scenario with examples', async () => {
        await parse(
          `Feature: hello
  Scenario:
    Given a passed step
    And a <status> step

    Examples:
      | status |
      | passed |
      | failed |
`
        )

        const scenarioStepId = envelopes.find(
          (envelope) => envelope.gherkinDocument
        ).gherkinDocument.feature.children[0].scenario.steps[1].id

        const pickleStepIds = envelopes
          .filter((envelope) => envelope.pickle)
          .map((envelope) => envelope.pickle.steps[1].id)

        assert.deepEqual(
          gherkinQuery.getPickleStepIdsFromAstNodeId(scenarioStepId),
          pickleStepIds
        )
      })
    })
  })

  function parse(gherkinSource: string): Promise<void> {
    const writable = new Writable({
      objectMode: true,
      write(
        envelope: messages.IEnvelope,
        encoding: string,
        callback: (error?: Error | null) => void
      ): void {
        envelopes.push(envelope)
        try {
          gherkinQuery.update(envelope)
          callback()
        } catch (err) {
          callback(err)
        }
      },
    })
    return pipelinePromise(
      gherkinMessages(gherkinSource, 'test.feature'),
      writable
    )
  }

  function gherkinMessages(gherkinSource: string, uri: string): Readable {
    const source = messages.Envelope.fromObject({
      source: {
        uri,
        data: gherkinSource,
        mediaType: 'text/x.cucumber.gherkin+plain',
      },
    })

    const newId = IdGenerator.incrementing()
    return GherkinStreams.fromSources([source], { newId })
  }
})
