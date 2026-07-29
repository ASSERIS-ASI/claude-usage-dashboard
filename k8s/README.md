# Kubernetes

This deployment runs Claude Usage Dashboard as a standalone application.

The production overlay uses:

- Deployment `claude-app`
- Service `claude-app` on port `3333`
- an environment-specific Ingress host
- PVC `claude-usage-dashboard-state`

Render the manifests locally:

```sh
kubectl kustomize k8s/overlays/prod
```

Apply them:

```sh
kubectl apply -k k8s/overlays/prod
```

Replace the example Ingress host before applying the overlay. Deployment
automation may also replace the image tag with an immutable release or commit
tag.
