package infra

import (
	"context"
	"fmt"
	"strings"

	"github.com/azure/azure-dev/cli/azd/pkg/tools"
)

type AzureResourceManager struct {
	azCli tools.AzCli
}

func NewAzureResourceManager(azCli tools.AzCli) *AzureResourceManager {
	return &AzureResourceManager{
		azCli: azCli,
	}
}

func (rm *AzureResourceManager) GetDeploymentResourceOperations(ctx context.Context, subscriptionId string, deploymentName string) (*[]tools.AzCliResourceOperation, error) {
	// Gets all the subscription level deployments
	subOperations, err := rm.azCli.ListSubscriptionDeploymentOperations(ctx, subscriptionId, deploymentName)
	if err != nil {
		return nil, fmt.Errorf("getting subscription deployment: %w", err)
	}

	var resourceGroupName string

	// Find the resource group
	for _, operation := range subOperations {
		if operation.Properties.TargetResource.ResourceType == string(AzureResourceTypeResourceGroup) {
			resourceGroupName = operation.Properties.TargetResource.ResourceName
			break
		}
	}

	resourceOperations := []tools.AzCliResourceOperation{}

	if strings.TrimSpace(resourceGroupName) == "" {
		return &resourceOperations, nil
	}

	// Find all resource group deployments within the subscription operations
	// Recursively append any resource group deployments that are found
	for _, operation := range subOperations {
		if operation.Properties.TargetResource.ResourceType == string(AzureResourceTypeDeployment) {
			err = rm.appendDeploymentResourcesRecursive(ctx, subscriptionId, resourceGroupName, operation.Properties.TargetResource.ResourceName, &resourceOperations)
			if err != nil {
				return nil, fmt.Errorf("appending deployment resources: %w", err)
			}
		}
	}

	return &resourceOperations, nil
}

func (rm *AzureResourceManager) appendDeploymentResourcesRecursive(ctx context.Context, subscriptionId string, resourceGroupName string, deploymentName string, resourceOperations *[]tools.AzCliResourceOperation) error {
	operations, err := rm.azCli.ListResourceGroupDeploymentOperations(ctx, subscriptionId, resourceGroupName, deploymentName)
	if err != nil {
		return fmt.Errorf("getting subscription deployment operations: %w", err)
	}

	for _, operation := range operations {
		if operation.Properties.TargetResource.ResourceType == string(AzureResourceTypeDeployment) {
			err := rm.appendDeploymentResourcesRecursive(ctx, subscriptionId, resourceGroupName, operation.Properties.TargetResource.ResourceName, resourceOperations)
			if err != nil {
				return fmt.Errorf("appending deployment resources: %w", err)
			}
		} else if operation.Properties.ProvisioningOperation == "Create" && strings.TrimSpace(operation.Properties.TargetResource.ResourceType) != "" {
			*resourceOperations = append(*resourceOperations, operation)
		}
	}

	return nil
}
