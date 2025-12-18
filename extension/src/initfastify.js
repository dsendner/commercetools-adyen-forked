import fastify from 'fastify'
import errorMessages from './validator/error-messages.js';
import makePaymentHandler from "./paymentHandler/make-payment.handler.js"
import getPaymentMethodsHandler from "./paymentHandler/get-payment-methods.handler.js"
import submitPaymentDetailsHandler from "./paymentHandler/submit-payment-details.handler.js"
import { hasValidAuthorizationHeader, getStoredCredential } from './validator/authentication.js';
import ctpClientBuilder from './ctp.js'
import utils from './utils.js'
import config from './config/config.js'
import { ensureCustomTypes } from './config/init/ensure-resources.js'
import { createApiBuilderFromCtpClient } from '@commercetools/platform-sdk';
import paymentHandler from './paymentHandler/payment-handler.js'

/**
 * @type {Map<string, ByProjectKeyRequestBuilder>}
 */
const apiBuilders = new Map()
const logger = utils.getLogger()


async function setupExtensionResources() {
  const ctpProjectKeys = config.getAllCtpProjectKeys()
  const adyenMerchantAccounts = config.getAllAdyenMerchantAccounts()

  await Promise.all(
    ctpProjectKeys.map(async (ctpProjectKey) => {
      const ctpConfig = config.getCtpConfig(ctpProjectKey)
      const ctpClient = await ctpClientBuilder.get(ctpConfig)
      apiBuilders.set(ctpProjectKey, createApiBuilderFromCtpClient(ctpClient).withProjectKey({ projectKey: ctpProjectKey}))
      await ensureCustomTypes(ctpClient, ctpProjectKey)
    }),
  )

  logger.info(
    `Configured commercetools project keys are: ${JSON.stringify(
      ctpProjectKeys,
    )}. ` +
      `Configured adyen merchant accounts are: ${JSON.stringify(
        adyenMerchantAccounts,
      )}`,
  )
}

await setupExtensionResources()

const server = fastify()

const authHook = async (request, reply) => {
  const authToken = request.headers.authorization;
  const ctpProjectKey = request.headers["x-project-key"]
      const storedCredential = getStoredCredential(ctpProjectKey)
      if (!storedCredential)
        return reply.code(401).send({ 
          error: 'Unauthorized',
          message: errorMessages.MISSING_CREDENTIAL
        });
      else if (!hasValidAuthorizationHeader(storedCredential, authToken)) {
        return reply.code(401).send({ 
          error: 'Unauthorized',
          message: errorMessages.UNAUTHORIZED_REQUEST
        });
      }
      return this
    }

server.get('/health', (_, reply) => reply.status(200).send() )

server.post('/payments', {onRequest: authHook},async (request, reply) => {
  try {
    const ctpProjectKey = request.headers["x-project-key"]
    const authToken = request.headers.authorization

    // GET THE CTP CLIENT
    const apiBuilder = await apiBuilders.get(ctpProjectKey)

    // FETCH PAYMENT METHODS IN ADYEN
    const result = await paymentHandler.handlePayment(request.body, authToken)

    // SAVE PAYMENT METHODS IN THE CT PAYMENT OBJECT
    const payment = await apiBuilder.payments().withId({ ID: request.body.id }).post({ body: {
          version: request.body.version,
          actions: result.actions
        }}).execute()

    return reply.status(201).send(payment.body)
  } catch (err) {
    return reply.status(500).send(err)
  }
})

server.listen({ port: 8080, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }
  console.log(`Server listening at ${address}`)
})