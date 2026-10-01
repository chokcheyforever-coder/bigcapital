import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ClsMiddleware } from 'nestjs-cls';
import * as path from 'path';
import './utils/moment-mysql';
import { AppModule } from './modules/App/App.module';
import { NestExpressApplication } from '@nestjs/platform-express';

global.__public_dirname = path.join(__dirname, '..', 'public');
global.__static_dirname = path.join(__dirname, '../static');
global.__views_dirname = path.join(global.__static_dirname, '/views');
global.__images_dirname = path.join(global.__static_dirname, '/images');

// 103 DiTech: one tenant's failed background promise (e.g. an invite email
// when SMTP is unreachable) must not crash the process for every tenant on
// the cell. Node 18 exits on unhandled rejections by default; log instead.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  app.set('query parser', 'extended');
  // 103 DiTech: behind Traefik every request comes from the proxy's address,
  // so rate limits keyed by IP were shared by all tenants on the cell. Trust
  // exactly the proxy hops in front of the server (TRUST_PROXY_HOPS, 0 = none).
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops);
  app.setGlobalPrefix('/api');

  // create and mount the middleware manually here
  app.use(new ClsMiddleware({}).use);

  const config = new DocumentBuilder()
    .setTitle('Bigcapital')
    .setDescription('Financial accounting software')
    .setVersion('1.0')
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('swagger', app, documentFactory);

  await app.listen(process.env.PORT ?? 3000);

  // 103 DiTech: keep idle connections open longer than Traefik does (90 s),
  // so the proxy never reuses a connection Node is closing (Node's default
  // 5 s caused occasional 502s under load).
  const server = app.getHttpServer();
  server.keepAliveTimeout = 95_000;
  server.headersTimeout = 96_000;
}
bootstrap();
