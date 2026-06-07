// Delivery context helpers normalize target and route metadata for delivery.
export {
  channelRouteFromDeliveryContext,
  deliveryContextFromChannelRoute,
  deliveryContextFromSession,
  deliveryContextKey,
  mergeDeliveryContext,
  normalizeDeliveryContext,
  normalizeSessionDeliveryFields,
} from "./delivery-context.shared.js";
export type { DeliveryContext, DeliveryContextSessionSource } from "./delivery-context.types.js";
