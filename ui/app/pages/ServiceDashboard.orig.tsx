import React from 'react';
import { Page } from '@dynatrace/strato-components-preview/layouts';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading, Paragraph } from '@dynatrace/strato-components/typography';

export const ServiceDashboard = () => {
  return (
    <Page>
      <Page.Header>
        <Heading level={1}>Service Dashboard</Heading>
      </Page.Header>
      <Page.Main>
        <Flex flexDirection="column" gap={24} padding={32}>
          <Paragraph>Service monitoring and management coming soon...</Paragraph>
        </Flex>
      </Page.Main>
    </Page>
  );
};
