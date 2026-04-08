import { RootRoute, FileRoutesByPath, Route } from '@tanstack/react-router'
import { Route as rootRoute } from './routes/__root'
import { Route as authenticatedRoute } from './routes/_authenticated'
import { Route as authenticatedIndexRoute } from './routes/_authenticated/index'
import { Route as agentsRoute } from './routes/_authenticated/agents'
import { Route as chainsRoute } from './routes/_authenticated/chains'
import { Route as cronRoute } from './routes/_authenticated/cron'
import { Route as chatRoute } from './routes/_authenticated/chat'
import { Route as omegaRoute } from './routes/_authenticated/omega'
import { Route as knowledgeRoute } from './routes/_authenticated/knowledge'
import { Route as cognitiveRoute } from './routes/_authenticated/cognitive'
import { Route as pheromoneRoute } from './routes/_authenticated/pheromone'
import { Route as fleetLearningRoute } from './routes/_authenticated/fleet-learning'
import { Route as inventorRoute } from './routes/_authenticated/inventor'
import { Route as anomalyRoute } from './routes/_authenticated/anomaly'
import { Route as auditRoute } from './routes/_authenticated/audit'
import { Route as costRoute } from './routes/_authenticated/cost'
import { Route as adoptionRoute } from './routes/_authenticated/adoption'
import { Route as openClawRoute } from './routes/_authenticated/openclaw'
import { Route as obsidianRoute } from './routes/_authenticated/obsidian'
import { Route as settingsRoute } from './routes/_authenticated/settings'
import { Route as accountSettingsRoute } from './routes/_authenticated/settings/account'
import { Route as appearanceSettingsRoute } from './routes/_authenticated/settings/appearance'
import { Route as activitySettingsRoute } from './routes/_authenticated/settings/activity'
import { Route as integrationsSettingsRoute } from './routes/_authenticated/settings/integrations'
import { Route as apiKeysSettingsRoute } from './routes/_authenticated/settings/api-keys'
import { Route as signInRoute } from './routes/(auth)/sign-in'

export const routeTree = rootRoute.addChildren([
  authenticatedRoute.addChildren([
    authenticatedIndexRoute,
    agentsRoute,
    chainsRoute,
    cronRoute,
    chatRoute,
    omegaRoute,
    knowledgeRoute,
    cognitiveRoute,
    pheromoneRoute,
    fleetLearningRoute,
    inventorRoute,
    anomalyRoute,
    auditRoute,
    costRoute,
    adoptionRoute,
    openClawRoute,
    obsidianRoute,
    settingsRoute.addChildren([
      accountSettingsRoute,
      appearanceSettingsRoute,
      activitySettingsRoute,
      integrationsSettingsRoute,
      apiKeysSettingsRoute,
    ]),
  ]),
  signInRoute,
])

export type RouteTree = typeof routeTree
