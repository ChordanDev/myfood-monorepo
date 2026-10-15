# Src Architecture

## Estructura del Proyecto

Este proyecto utiliza una arquitectura de **Features** basada en funcionalidades, que proporciona mejor escalabilidad y mantenibilidad.

### Directorios Principales

```
src/
├── components/      # Componentes UI globales y atómicos (botones, inputs, tarjetas)
├── features/        # Funcionalidades principales
│   ├── auth/       # Feature de autenticación
│   │   ├── components/
│   │   ├── hooks/
│   │   └── screens/
│   └── home/       # Feature de inicio
│       ├── components/
│       ├── hooks/
│       └── screens/
├── services/        # Servicios API y llamadas a servidor (Elixir)
├── store/          # Gestión de estado (Zustand/Context)
├── types/          # Interfaces y tipos TypeScript globales
└── utils/          # Funciones de ayuda y validaciones
```

### Estructura de una Feature

Cada funcionalidad tiene su propia carpeta con la siguiente estructura:

```
src/features/[feature-name]/
├── components/     # Componentes específicos de la feature
├── hooks/         # Custom hooks específicos de la feature
├── screens/       # Pantallas principales de la feature
├── store/         # Estado propio de la feature (opcional)
├── types/         # Tipos propios de la feature (opcional)
├── fixtures/      # Respuestas congeladas de la API para los tests (opcional)
├── domain/        # Lógica pura de la feature (opcional)
├── constants/     # Constantes propias de la feature (opcional)
└── index.ts       # Archivo de exportación (opcional)
```

Una feature es dueña de todo lo que solo ella usa: su `store/`, `types/`, `fixtures/`, `domain/` y `constants/` viven dentro de su carpeta. Las carpetas globales (`src/store`, `src/types`, `src/components`) quedan reservadas para lo que comparten varias features.

Dentro de una feature los módulos se importan entre sí por ruta relativa. El `index.ts` raíz expone únicamente lo que usa el resto de la app. Los módulos sin UI de otra feature (por ejemplo, otro store) importan `@/features/[feature-name]/store` para no cargar sus pantallas.

### Convenciones

- **Global Components** (`src/components`): Componentes reutilizables en toda la app (Button, Input, Card)
- **Feature Components** (`src/features/[name]/components`): Componentes específicos de la funcionalidad
- **Services** (`src/services`): Manejo de requests HTTP hacia la API de Elixir
- **Socket** (`src/api/socket`): Único dueño del cliente Phoenix (conexión, token, join y reconexión). Las features usan `getSocketClient()` y nunca importan `phoenix` directamente; ESLint lo impide fuera de esa carpeta
- **Store** (`src/store`): Estado global con Zustand o Context API, compartido entre features
- **Types** (`src/types`): Tipos e interfaces globales compartidas entre features
- **Utils** (`src/utils`): Funciones auxiliares, validadores, formateadores

### Inicio Rápido

El punto de entrada es `app/_layout.tsx`, que configura el Stack Navigator.

Las rutas se definen en carpetas bajo `app/` siguiendo las convenciones de Expo Router.
