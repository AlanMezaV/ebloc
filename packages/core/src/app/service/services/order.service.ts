import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ErrorResult, ValidTransitions, validateEmail } from '../utils';

import {
  AddPaymentToOrderInput,
  AddShipmentToOrderInput,
  CreateAddressInput,
  CreateCustomerInput,
  CreateOrderLineInput,
  ListInput,
  OrderErrorCode,
  UpdateOrderLineInput
} from '@/app/api/common';
import { getConfig } from '@/app/config';
import {
  AddressEntity,
  CustomerEntity,
  ID,
  OrderEntity,
  OrderLineEntity,
  OrderState,
  PaymentEntity,
  PaymentMethodEntity,
  ShipmentEntity,
  ShippingMethodEntity,
  VariantEntity
} from '@/app/persistance';

@Injectable()
export class OrderService {
  constructor(@InjectDataSource() private db: DataSource) {}

  async find(input: ListInput) {
    return await this.db.getRepository(OrderEntity).find({
      skip: input?.skip,
      take: input?.take,
      order: { createdAt: 'DESC' }
    });
  }

  async findUnique(id: ID, code: string) {
    if (id) {
      return this.findById(id);
    }

    if (code) {
      return this.findByCode(code);
    }

    return null;
  }

  async findLines(orderId: ID) {
    const lines = await this.db.getRepository(OrderLineEntity).find({
      where: { order: { id: orderId } },
      order: { createdAt: 'DESC' }
    });

    return lines;
  }

  async findVariantInLine(orderLineId: ID) {
    const orderLine = await this.db.getRepository(OrderLineEntity).findOne({
      where: { id: orderLineId },
      relations: { productVariant: true }
    });

    return orderLine.productVariant;
  }

  async findCustomer(orderId: ID) {
    const order = await this.db.getRepository(OrderEntity).findOne({
      where: { id: orderId },
      relations: { customer: true }
    });

    return order.customer;
  }

  async findShippingAddress(orderId: ID) {
    const order = await this.db.getRepository(OrderEntity).findOne({
      where: { id: orderId }
    });

    if (!order.shippingAddress) {
      return null;
    }

    // The shipping address could be a json or a Address entity, so we need to normalize it
    return { id: '', createdAt: '', updatedAt: '', ...order.shippingAddress };
  }

  async findPayment(orderId: ID) {
    const order = await this.db.getRepository(OrderEntity).findOne({
      where: { id: orderId },
      relations: { payment: true }
    });

    return order.payment;
  }

  async findShipment(orderId: ID) {
    const order = await this.db.getRepository(OrderEntity).findOne({
      where: { id: orderId },
      relations: { shipment: true }
    });

    return order.shipment;
  }

  /**
   * Creates an empty order
   * @returns Error Result or created order
   */
  async create() {
    const ordersCount = await this.db.getRepository(OrderEntity).count();
    const order = this.db.getRepository(OrderEntity).create({
      code: String(ordersCount + 1)
    });

    return await this.db.getRepository(OrderEntity).save(order);
  }

  /**
   * Adds line to order
   * @param orderId Order id to add line
   * @param input Order line input
   * @returns Error Result or Order entity
   */
  async addLine(
    orderId: ID,
    input: CreateOrderLineInput
  ): Promise<ErrorResult<OrderErrorCode> | OrderEntity> {
    const order = await this.db.getRepository(OrderEntity).findOne({
      where: { id: orderId },
      relations: { lines: { productVariant: true } }
    });

    if (!order) {
      return new ErrorResult(OrderErrorCode.ORDER_NOT_FOUND, 'Order not found with the given id');
    }

    if (order.state !== OrderState.MODIFYING) {
      return new ErrorResult(
        OrderErrorCode.ORDER_TRANSITION_ERROR,
        `Unable to add line to order in state ${order.state}`
      );
    }

    const variant = await this.db.getRepository(VariantEntity).findOne({
      where: { id: input.productVariantId }
    });

    const variantInOrderLine = order.lines.find(line => line.productVariant.id === variant.id);

    if (variantInOrderLine) {
      return this.updateLine(variantInOrderLine.id, {
        quantity: input.quantity + variantInOrderLine.quantity
      });
    }

    if (variant.stock < input.quantity) {
      return new ErrorResult(OrderErrorCode.NOT_ENOUGH_STOCK, 'Not enough stock');
    }

    const unitPrice = variant.price;
    const linePrice = unitPrice * input.quantity;

    const orderLine = this.db.getRepository(OrderLineEntity).create({
      productVariant: variant,
      quantity: input.quantity,
      unitPrice,
      linePrice,
      order
    });

    await this.db.getRepository(OrderLineEntity).save(orderLine);

    return this.recalculateOrderStats(order.id);
  }

  /**
   * Updates line
   * @param lineId Line id to update
   * @param input Line input to update
   * @returns Error Result or Order entity
   */
  async updateLine(
    lineId: ID,
    input: UpdateOrderLineInput
  ): Promise<ErrorResult<OrderErrorCode> | OrderEntity> {
    const lineToUpdate = await this.db.getRepository(OrderLineEntity).findOne({
      where: { id: lineId },
      relations: { productVariant: true, order: true }
    });

    if (!lineToUpdate) {
      return new ErrorResult(OrderErrorCode.LINE_NOT_FOUND, 'line not found');
    }

    if (lineToUpdate.order.state !== OrderState.MODIFYING) {
      return new ErrorResult(
        OrderErrorCode.ORDER_TRANSITION_ERROR,
        `Unable to update line to order in state ${lineToUpdate.order.state}`
      );
    }

    const variant = lineToUpdate.productVariant;

    if (input.quantity === 0) {
      return await this.removeLine(lineId);
    }

    if (variant.stock < input.quantity) {
      return new ErrorResult(OrderErrorCode.NOT_ENOUGH_STOCK, 'Not enough stock');
    }

    const unitPrice = variant.price;
    const linePrice = unitPrice * input.quantity;

    await this.db.getRepository(OrderLineEntity).save({
      ...lineToUpdate,
      unitPrice,
      linePrice,
      quantity: input.quantity
    });

    return this.recalculateOrderStats(lineToUpdate.order.id);
  }

  /**
   *
   * @param orderLineId line id to remove
   * @returns Error Result or Order entity
   */
  async removeLine(orderLineId: ID): Promise<ErrorResult<OrderErrorCode> | OrderEntity> {
    const orderLine = await this.db.getRepository(OrderLineEntity).findOne({
      where: { id: orderLineId },
      relations: { order: true }
    });

    if (!orderLine) {
      return new ErrorResult(OrderErrorCode.LINE_NOT_FOUND, 'Line not found');
    }

    if (orderLine.order.state !== OrderState.MODIFYING) {
      return new ErrorResult(
        OrderErrorCode.ORDER_TRANSITION_ERROR,
        `Unable to remove line to order in state ${orderLine.order.state}`
      );
    }

    await this.db.getRepository(OrderLineEntity).delete(orderLine.id);

    return this.recalculateOrderStats(orderLine.order.id);
  }

  /**
   * Add customer to order if exists, if not, create it and add it
   * @param orderId Order id to add customer
   * @param input Customer input
   * @returns Error Result or order entity
   */
  async addCustomer(
    orderId: ID,
    input: CreateCustomerInput
  ): Promise<ErrorResult<OrderErrorCode> | OrderEntity> {
    if (!validateEmail(input.email)) {
      return new ErrorResult(OrderErrorCode.CUSTOMER_INVALID_EMAIL, 'Invalid email');
    }

    const order = await this.db.getRepository(OrderEntity).findOne({
      where: { id: orderId }
    });

    if (!order) {
      return new ErrorResult(OrderErrorCode.ORDER_NOT_FOUND, 'Order not found');
    }

    if (order.state !== OrderState.MODIFYING) {
      return new ErrorResult(
        OrderErrorCode.ORDER_TRANSITION_ERROR,
        `Unable to add customer to order in state ${order.state}`
      );
    }

    const customer = await this.db.getRepository(CustomerEntity).findOne({
      where: { email: input.email }
    });

    let customerUpdated = this.db.getRepository(CustomerEntity).create({
      ...customer,
      ...input
    });

    customerUpdated = await this.db.getRepository(CustomerEntity).save(customerUpdated);

    order.customer = customerUpdated;

    await this.db.getRepository(OrderEntity).save(order);

    return this.recalculateOrderStats(order.id);
  }

  /**
   * Add shipping address to order
   * @param orderId Order id to add shipping address
   * @param input Shipping address input
   * @returns Error Result or order entity
   */
  async addShippingAddress(
    orderId: ID,
    input: CreateAddressInput
  ): Promise<ErrorResult<OrderErrorCode> | OrderEntity> {
    const order = await this.db.getRepository(OrderEntity).findOne({
      where: { id: orderId }
    });

    if (!order) {
      return new ErrorResult(OrderErrorCode.ORDER_NOT_FOUND, 'Order not found');
    }

    if (order.state !== OrderState.MODIFYING) {
      return new ErrorResult(
        OrderErrorCode.ORDER_TRANSITION_ERROR,
        `Unable to add shipping address to order in state ${order.state}`
      );
    }

    const address = this.db.getRepository(AddressEntity).create(input);

    order.shippingAddress = address;

    await this.db.getRepository(OrderEntity).save(order);

    return this.recalculateOrderStats(order.id);
  }

  /**
   * Add shipment to order using the shipment method specified
   * @param orderId order id to add shipment
   * @param input Shipmen input
   * @returns Error Result or order entity
   */
  async addShipment(
    orderId: ID,
    input: AddShipmentToOrderInput
  ): Promise<ErrorResult<OrderErrorCode> | OrderEntity> {
    const order = await this.db.getRepository(OrderEntity).findOne({
      where: { id: orderId },
      relations: { lines: true, customer: true }
    });

    if (!order) {
      return new ErrorResult(OrderErrorCode.ORDER_NOT_FOUND, 'Order not found');
    }

    if (order.state !== OrderState.MODIFYING) {
      return new ErrorResult(
        OrderErrorCode.ORDER_TRANSITION_ERROR,
        `Unable to add shipment to order in state ${order.state}`
      );
    }

    const shippingMethod = await this.db
      .getRepository(ShippingMethodEntity)
      .findOne({ where: { id: input.shippingMethodId } });

    if (!shippingMethod) {
      return new ErrorResult(OrderErrorCode.SHIPPING_METHOD_NOT_FOUND, `Shipping method not found`);
    }

    // TODO: Do I have to validate if calculator exists?
    const shippingPriceCalculator = getConfig().shipping.priceCalculators.find(
      p => p.code === shippingMethod.priceCalculatorCode
    );

    const shippingPrice = await shippingPriceCalculator.calculatePrice(order);

    const shipment = await this.db.getRepository(ShipmentEntity).save({
      amount: shippingPrice,
      method: shippingMethod
    });

    await this.db.getRepository(OrderEntity).save({
      ...order,
      shipment
    });

    return this.recalculateOrderStats(order.id);
  }

  /**
   * Add payment to order using the payment method specified
   * @param orderId Order id to add payment
   * @param input Payment Input
   * @returns Error Result or order entity
   */
  async addPayment(
    orderId: ID,
    input: AddPaymentToOrderInput
  ): Promise<ErrorResult<OrderErrorCode> | OrderEntity> {
    const order = await this.db.getRepository(OrderEntity).findOne({
      where: { id: orderId },
      relations: { customer: true, lines: { productVariant: true } }
    });

    if (!order) {
      return new ErrorResult(OrderErrorCode.ORDER_NOT_FOUND, 'Order not found');
    }

    if (!this.validateOrderTransitionState(order, OrderState.PAYMENT_ADDED)) {
      return new ErrorResult(
        OrderErrorCode.ORDER_TRANSITION_ERROR,
        `Unable to add payment to order in state ${order.state}`
      );
    }

    const paymentMethod = await this.db.getRepository(PaymentMethodEntity).findOne({
      where: { id: input.methodId }
    });

    if (!paymentMethod) {
      return new ErrorResult(OrderErrorCode.PAYMENT_METHOD_NOT_FOUND, 'Payment method not found');
    }

    const paymentIntegration = getConfig().payments.integrations.find(
      p => p.code === paymentMethod.integrationCode
    );

    const paymentIntegrationResult = await paymentIntegration.createPayment(order);

    // TODO: do something with paymentIntegrationResult.error
    if (paymentIntegrationResult.status === 'declined') {
      return new ErrorResult(OrderErrorCode.PAYMENT_DECLINED, 'Payment declined');
    }

    if (paymentIntegrationResult.status === 'created') {
      const payment = await this.db.getRepository(PaymentEntity).save({
        amount: order.total,
        method: paymentMethod
      });

      await this.db.getRepository(OrderEntity).save({
        ...order,
        payment,
        state: OrderState.PAYMENT_ADDED,
        placedAt: new Date()
      });
    }

    if (paymentIntegrationResult.status === 'authorized') {
      const payment = await this.db.getRepository(PaymentEntity).save({
        amount: paymentIntegrationResult.amount,
        method: paymentMethod,
        transactionId: paymentIntegrationResult.transactionId
      });

      await this.db.getRepository(OrderEntity).save({
        ...order,
        payment,
        state: OrderState.PAYMENT_AUTHORIZED,
        placedAt: new Date()
      });
    }

    await this.db.getRepository(VariantEntity).save(
      order.lines.map(l => ({
        ...l.productVariant,
        stock: l.productVariant.stock - l.quantity
      }))
    );

    return this.recalculateOrderStats(order.id);
  }

  /**
   * Validate if the order can transition to the new state
   */
  private validateOrderTransitionState(order: OrderEntity, state: OrderState) {
    const prevState = order.state;
    const nextState = state;

    return ValidTransitions.some(t => t[0] === prevState && t[1] === nextState);
  }

  /**
   * Apply price and quantity adjustments to the order after an update
   */
  private async recalculateOrderStats(orderId: ID) {
    const order = await this.db.getRepository(OrderEntity).findOne({
      where: { id: orderId },
      relations: { lines: true, shipment: true }
    });

    const subtotal = order.lines.reduce((acc, line) => acc + line.linePrice, 0);
    const total = subtotal + (order.shipment?.amount ?? 0);
    const totalQuantity = order.lines.reduce((acc, line) => acc + line.quantity, 0);

    return await this.db.getRepository(OrderEntity).save({
      ...order,
      total,
      subtotal,
      totalQuantity
    });
  }

  private async findById(id: ID) {
    return this.db.getRepository(OrderEntity).findOne({ where: { id } });
  }

  private async findByCode(code: string) {
    return this.db.getRepository(OrderEntity).findOne({ where: { code } });
  }
}
