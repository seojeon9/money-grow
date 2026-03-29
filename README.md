This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

```bash
npm install
npm run dev
```

또는

```bash
yarn dev
pnpm dev
bun dev
```

### `main-app.js` / `app-pages-internals.js` 404

보통 아래 때문에 납니다.

1. **`next dev`가 여러 개 실행됨** — 예전 프로세스가 3000을 잡고 있고, 새로 빌드한 쪽은 다른 포트인데 브라우저만 계속 3000으로 여는 경우.
2. **`.next` 캐시 불일치** — `next build`와 `next dev`를 섞거나, 빌드 도중 끊기면 HTML과 실제 청크가 어긋날 수 있음.

**조치:** 한 번에 dev는 하나만 쓰고, 포트를 꼬이지 않게 정리합니다.

```bash
# 터미널에서 기존 next dev 전부 종료(Ctrl+C) 후
cd web
npm run dev:clean
```

브라우저는 **강력 새로고침**(Chrome: ⌘⇧R) 또는 시크릿 창에서, 터미널에 찍힌 **정확한 `http://localhost:포트`** 로 엽니다.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
