import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';

const DbUrl = {
  remote:
    'postgresql://postgres:C635-525g65d6fEecce*eAc6fBDf5F6G@viaduct.proxy.rlwy.net:16696/railway',
  local: 'postgres://postgres:postgres@localhost:5432/vendyx',
};

const prepareForExpo = async () => {
  console.log('Preparing for Expo 🚀');
  console.log();

  const dataSource = await new DataSource({
    type: 'postgres',
    url: DbUrl.local,
    synchronize: false,
  }).initialize();

  console.log('Cleaning the database 🧹');
  await dataSource.query('DELETE FROM "administrator";');
  await dataSource.query('DELETE FROM "order_line";');
  await dataSource.query('DELETE FROM "orders";');
  await dataSource.query('DELETE FROM "customer";');
  await dataSource.query('DELETE FROM "address";');
  await dataSource.query('DELETE FROM "payment";');
  await dataSource.query('DELETE FROM "shipment";');
  await dataSource.query('DELETE FROM "shipping_method";');
  await dataSource.query('DELETE FROM "payment_method";');
  console.log('Database cleaned ✨');
  console.log();

  console.log('Generating admin user 🧑‍💼');
  const username = 'admin';
  const password = bcrypt.hashSync('admin', 10);
  await dataSource.query(
    `INSERT INTO administrator (username, password) VALUES ('${username}', '${password}');`,
  );
  console.log('Admin user generated ✨');
  console.log("Username: 'admin'");
  console.log("Password: 'admin'");
  console.log();

  console.log('Adding shipping and payment methods 🚚 💳');
  await dataSource.query(`
    INSERT INTO shipping_method (name, description, price_calculator_code, enabled)
    VALUES ('Fedex', 'Envíos con Fedex', 'fedex-calculator', true);

    INSERT INTO payment_method (name, description, integration_code, enabled)
    VALUES ('Stripe', 'Pago con tarjeta de crédito y débito', 'stripe', true),
           ('PayPal', 'Pago con tu cuenta de PayPal', 'paypal', true);
  `);
  console.log('Shipping and payment methods added ✨');
  console.log("Shipping methods: 'Fedex'");
  console.log("Payment methods: 'Stripe', 'PayPal'");
  console.log();

  console.log('Preparation for Expo is completed 🎉');
  await dataSource.destroy();
};

prepareForExpo();
